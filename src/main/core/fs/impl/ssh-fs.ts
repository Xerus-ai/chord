import type { SFTPWrapper } from 'ssh2';
import type { FileWatchEvent } from '@shared/fs';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileEntry,
  type FileListResult,
  type FileSystemProvider,
  type FileWatcher,
  type ListOptions,
  type ReadResult,
  type SearchOptions,
  type SearchResult,
  type WriteResult,
} from '../types';
import {
  DEFAULT_MAX_BYTES,
  mapSftpError,
  MAX_READ_SIZE,
  SFTP_STATUS,
  type SftpError,
} from './ssh-fs-errors';
import { relativePath, resolveRemotePath } from './ssh-fs-path';
import { sshReadImage, sshRemove } from './ssh-fs-project';
import { sshListRecursive, sshSearch } from './ssh-fs-search';
import { createSshWatcher } from './ssh-fs-watcher';

export class SshFileSystem implements FileSystemProvider {
  private cachedSftp: SFTPWrapper | undefined;

  constructor(
    private readonly proxy: SshClientProxy,
    private readonly remotePath: string
  ) {
    if (!remotePath) {
      throw new FileSystemError('Remote path is required', FileSystemErrorCodes.INVALID_PATH);
    }
    this.remotePath = remotePath.replace(/\\/g, '/');
  }

  private getSftp(): Promise<SFTPWrapper> {
    if (this.cachedSftp) return Promise.resolve(this.cachedSftp);
    return new Promise((resolve, reject) => {
      this.proxy.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.cachedSftp = sftp;
        sftp.on('close', () => {
          this.cachedSftp = undefined;
        });
        resolve(sftp);
      });
    });
  }

  private exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const full = `bash -l -c ${quoteShellArg(command)}`;
    return new Promise((resolve, reject) => {
      this.proxy.client.exec(full, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });
        stream.on('error', reject);
      });
    });
  }

  private resolvePath(relPath: string): string {
    return resolveRemotePath(this.remotePath, relPath);
  }

  private relPath(fullPath: string): string {
    return relativePath(this.remotePath, fullPath);
  }

  async list(path: string = '', options?: ListOptions): Promise<FileListResult> {
    const startTime = Date.now();
    const fullPath = this.resolvePath(path);
    const sftp = await this.getSftp();

    return new Promise((resolve, reject) => {
      sftp.readdir(fullPath, (err, list) => {
        if (err) {
          reject(mapSftpError(err, fullPath));
          return;
        }

        const entries: FileEntry[] = [];
        const seen = new Set<string>();

        for (const item of list) {
          if (!options?.includeHidden && item.filename.startsWith('.')) continue;

          if (options?.filter) {
            const filterRegex = new RegExp(options.filter);
            if (!filterRegex.test(item.filename)) continue;
          }

          const entryPath = this.relPath(`${fullPath}/${item.filename}`);
          if (seen.has(entryPath)) continue;
          seen.add(entryPath);

          entries.push({
            path: entryPath,
            type: item.attrs.isDirectory() ? 'dir' : 'file',
            size: item.attrs.size,
            mtime: new Date(item.attrs.mtime * 1000),
            ctime: new Date(item.attrs.atime * 1000),
            mode: item.attrs.mode,
          });
        }

        entries.sort((a, b) => {
          if (a.type === b.type) return a.path.localeCompare(b.path);
          return a.type === 'dir' ? -1 : 1;
        });

        let result = entries;
        let truncated = false;
        let truncateReason: 'maxEntries' | 'timeBudget' | undefined;

        if (options?.maxEntries && entries.length > options.maxEntries) {
          result = entries.slice(0, options.maxEntries);
          truncated = true;
          truncateReason = 'maxEntries';
        }

        const durationMs = Date.now() - startTime;
        if (options?.timeBudgetMs && durationMs > options.timeBudgetMs) {
          truncated = true;
          truncateReason = 'timeBudget';
        }

        resolve({ entries: result, total: entries.length, truncated, truncateReason, durationMs });
      });
    });
  }

  async read(path: string, maxBytes: number = DEFAULT_MAX_BYTES): Promise<ReadResult> {
    const fullPath = this.resolvePath(path);
    const sftp = await this.getSftp();

    return new Promise((resolve, reject) => {
      sftp.open(fullPath, 'r', (err, handle) => {
        if (err) {
          reject(mapSftpError(err, fullPath));
          return;
        }

        sftp.fstat(handle, (statErr, stats) => {
          if (statErr) {
            sftp.close(handle, () => {});
            reject(mapSftpError(statErr, fullPath));
            return;
          }

          if (stats.isDirectory()) {
            sftp.close(handle, () => {});
            reject(
              new FileSystemError(
                `Path is a directory: ${path}`,
                FileSystemErrorCodes.IS_DIRECTORY,
                path
              )
            );
            return;
          }

          const fileSize = stats.size;
          const readSize = Math.min(fileSize, maxBytes, MAX_READ_SIZE);

          if (readSize === 0) {
            sftp.close(handle, () => {});
            resolve({ content: '', truncated: false, totalSize: fileSize });
            return;
          }

          const buffer = Buffer.alloc(readSize);

          sftp.read(handle, buffer, 0, readSize, 0, (readErr, bytesRead) => {
            sftp.close(handle, () => {});

            if (readErr) {
              reject(mapSftpError(readErr, fullPath));
              return;
            }

            const content = buffer.subarray(0, bytesRead).toString('utf-8');
            resolve({ content, truncated: fileSize > maxBytes, totalSize: fileSize });
          });
        });
      });
    });
  }

  async write(path: string, content: string): Promise<WriteResult> {
    const fullPath = this.resolvePath(path);
    const sftp = await this.getSftp();

    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const parentDir = fullPath.substring(0, lastSlash);
      await this.ensureRemoteDir(sftp, parentDir);
    }

    return new Promise((resolve, reject) => {
      sftp.open(fullPath, 'w', (err, handle) => {
        if (err) {
          reject(mapSftpError(err, fullPath));
          return;
        }

        const buffer = Buffer.from(content, 'utf-8');

        if (buffer.length === 0) {
          sftp.close(handle, (closeErr) => {
            if (closeErr) {
              reject(mapSftpError(closeErr, fullPath));
              return;
            }
            resolve({ success: true, bytesWritten: 0 });
          });
          return;
        }

        sftp.write(handle, buffer, 0, buffer.length, 0, (writeErr) => {
          sftp.close(handle, (closeErr) => {
            if (writeErr) {
              reject(mapSftpError(writeErr, fullPath));
              return;
            }
            if (closeErr) {
              reject(mapSftpError(closeErr, fullPath));
              return;
            }
            resolve({ success: true, bytesWritten: buffer.length });
          });
        });
      });
    });
  }

  async listRecursive(options?: { includeDirs?: boolean; maxEntries?: number }): Promise<{
    items: Array<{ path: string; type: 'file' | 'dir' }>;
    truncated: boolean;
  }> {
    return sshListRecursive(this.remotePath, (cmd) => this.exec(cmd), options);
  }

  async exists(path: string): Promise<boolean> {
    try {
      const entry = await this.stat(path);
      return entry !== null;
    } catch {
      return false;
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const fullPath = this.resolvePath(dirPath);
    const sftp = await this.getSftp();
    if (options?.recursive) {
      await this.ensureRemoteDir(sftp, fullPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(fullPath, (err) => (err ? reject(mapSftpError(err, fullPath)) : resolve()));
      });
    }
  }

  async realPath(path: string): Promise<string> {
    const fullPath = this.resolvePath(path);
    const result = await this.exec(`realpath ${quoteShellArg(fullPath)}`);
    if (result.exitCode !== 0) {
      throw new Error(`realpath failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  }

  async glob(pattern: string, options?: { cwd?: string; dot?: boolean }): Promise<string[]> {
    const cwd = options?.cwd ? this.resolvePath(options.cwd) : this.remotePath;
    const dotSetup = options?.dot ? 'shopt -s dotglob;' : '';
    const command = `${dotSetup} shopt -s nullglob; cd ${quoteShellArg(cwd)} && printf '%s\\n' ${pattern}`;
    try {
      const result = await this.exec(command);
      if (result.exitCode !== 0) return [];
      return result.stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async copyLocalFile(localAbsPath: string, destRelPath: string): Promise<void> {
    const sftp = await this.getSftp();
    const remoteFull = this.resolvePath(destRelPath);
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localAbsPath, remoteFull, (e) => (e ? reject(e) : resolve()));
    });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const fullSrc = this.resolvePath(src);
    const fullDest = this.resolvePath(dest);
    const result = await this.exec(`cp ${quoteShellArg(fullSrc)} ${quoteShellArg(fullDest)}`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to copy file: ${result.stderr}`);
    }
  }

  async stat(path: string): Promise<FileEntry | null> {
    const fullPath = this.resolvePath(path);
    const sftp = await this.getSftp();

    return new Promise((resolve, reject) => {
      sftp.stat(fullPath, (err, stats) => {
        if (err) {
          const sftpErr = err as SftpError;
          if (
            sftpErr.message?.includes('No such file') ||
            sftpErr.code === SFTP_STATUS.NO_SUCH_FILE
          ) {
            resolve(null);
            return;
          }
          reject(mapSftpError(err, fullPath));
          return;
        }

        resolve({
          path,
          type: stats.isDirectory() ? 'dir' : 'file',
          size: stats.size,
          mtime: new Date(stats.mtime * 1000),
          ctime: new Date(stats.atime * 1000),
          mode: stats.mode,
        });
      });
    });
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    return sshSearch(query, this.remotePath, (cmd) => this.exec(cmd), options);
  }

  async remove(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    return sshRemove(
      path,
      this.resolvePath(path),
      options,
      (p) => this.stat(p),
      () => this.getSftp(),
      (cmd) => this.exec(cmd)
    );
  }

  async readImage(path: string): Promise<{
    success: boolean;
    dataUrl?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  }> {
    const fullPath = this.resolvePath(path);
    const sftp = await this.getSftp();
    return sshReadImage(path, fullPath, sftp);
  }

  private async ensureRemoteDir(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (!err) {
          resolve();
          return;
        }

        const sftpErr = err as SftpError;
        const msg = sftpErr.message ?? '';
        const code = sftpErr.code;

        const isAlreadyExists =
          msg.includes('already exists') ||
          msg.includes('File exists') ||
          (code === SFTP_STATUS.FAILURE && (msg === 'Failure' || msg === ''));
        const isMissingParent = code === SFTP_STATUS.NO_SUCH_FILE || msg.includes('No such file');

        if (isAlreadyExists) {
          resolve();
          return;
        }

        const parentPath = dirPath.substring(0, dirPath.lastIndexOf('/'));
        if (
          isMissingParent &&
          parentPath &&
          parentPath !== dirPath &&
          parentPath.length >= this.remotePath.length
        ) {
          this.ensureRemoteDir(sftp, parentPath)
            .then(() => this.ensureRemoteDir(sftp, dirPath))
            .then(resolve)
            .catch(reject);
        } else {
          reject(mapSftpError(err, dirPath));
        }
      });
    });
  }

  watch(
    callback: (events: FileWatchEvent[]) => void,
    options: { debounceMs?: number } = {}
  ): FileWatcher {
    return createSshWatcher((p, opts) => this.list(p, opts), callback, options);
  }
}
