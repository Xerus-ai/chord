import { promises as fs, type Stats } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { glob } from 'glob';
import type { FileWatchEvent } from '@shared/fs';
import { log } from '@main/lib/logger';
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
import { localReadImage, localRemove, localSaveAttachment } from './local-fs-project';
import { localSearch } from './local-fs-search';
import { createLocalWatcher } from './local-fs-watcher';

const SEARCH_IGNORES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.parcel-cache',
]);

export class LocalFileSystem implements FileSystemProvider {
  private listAbort: AbortController | null = null;

  constructor(private projectPath: string) {
    if (!projectPath) {
      throw new FileSystemError('Project path is required', FileSystemErrorCodes.INVALID_PATH);
    }
    this.projectPath = resolve(projectPath);
  }

  cancelPendingList(): void {
    if (this.listAbort) {
      this.listAbort.abort();
      this.listAbort = null;
    }
  }

  private resolvePath(relPath: string): string {
    const normalizedRelPath = relPath.replace(/\\/g, '/').replace(/^\//, '');
    const fullPath = resolve(join(this.projectPath, normalizedRelPath));

    const projectPathWithSep = this.projectPath.endsWith(sep)
      ? this.projectPath
      : this.projectPath + sep;
    const fullPathWithSep = fullPath.endsWith(sep) ? fullPath : fullPath + sep;

    if (!fullPathWithSep.startsWith(projectPathWithSep) && fullPath !== this.projectPath) {
      throw new FileSystemError(
        `Path traversal detected: ${relPath}`,
        FileSystemErrorCodes.PATH_ESCAPE,
        relPath
      );
    }

    return fullPath;
  }

  private relPath(fullPath: string): string {
    // Provider contract: relative paths are POSIX-style on every platform
    // (resolvePath normalizes inputs the same way, and ssh-fs always emits
    // '/'), so Windows must not leak backslashes to consumers.
    return relative(this.projectPath, fullPath).replace(/\\/g, '/');
  }

  private statToEntry(fullPath: string, stat: Stats): FileEntry {
    return {
      path: this.relPath(fullPath),
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      mtime: stat.mtime,
      ctime: stat.ctime,
      mode: stat.mode,
    };
  }

  async list(path: string = '', options: ListOptions = {}): Promise<FileListResult> {
    const startTime = Date.now();
    const fullPath = this.resolvePath(path);
    const entries: FileEntry[] = [];
    const maxEntries = options.maxEntries || 10000;
    const timeBudgetMs = options.timeBudgetMs || 30000;

    const abort = new AbortController();
    this.listAbort = abort;

    let truncated = false;
    let truncateReason: 'maxEntries' | 'timeBudget' | undefined;

    const listDir = async (dirPath: string, recursive: boolean) => {
      if (abort.signal.aborted) return;

      if (Date.now() - startTime > timeBudgetMs) {
        truncated = true;
        truncateReason = 'timeBudget';
        return;
      }

      if (entries.length >= maxEntries) {
        truncated = true;
        truncateReason = 'maxEntries';
        return;
      }

      let items;
      try {
        items = await fs.readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        if (abort.signal.aborted) return;

        if (entries.length % 100 === 0 && Date.now() - startTime > timeBudgetMs) {
          truncated = true;
          truncateReason = 'timeBudget';
          return;
        }

        if (!options.includeHidden && item.name.startsWith('.')) continue;
        if (SEARCH_IGNORES.has(item.name)) continue;

        const itemPath = join(dirPath, item.name);

        try {
          const stat = await fs.stat(itemPath);
          const entry: FileEntry = {
            path: this.relPath(itemPath),
            type: item.isDirectory() ? 'dir' : 'file',
            size: stat.size,
            mtime: stat.mtime,
            ctime: stat.ctime,
            mode: stat.mode,
          };

          if (options.filter) {
            const filterRegex = new RegExp(options.filter);
            if (!filterRegex.test(item.name)) continue;
          }

          entries.push(entry);

          if (entries.length >= maxEntries) {
            truncated = true;
            truncateReason = 'maxEntries';
            return;
          }

          if (recursive && item.isDirectory()) {
            await listDir(itemPath, true);
          }
        } catch {}
      }
    };

    await listDir(fullPath, options.recursive || false);

    if (this.listAbort === abort) {
      this.listAbort = null;
    }

    return {
      entries,
      total: entries.length,
      truncated,
      truncateReason,
      durationMs: Date.now() - startTime,
    };
  }

  async read(path: string, maxBytes: number = 200 * 1024): Promise<ReadResult> {
    const fullPath = this.resolvePath(path);

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch (err) {
      log.error('Failed to stat file', { path, error: err });
      throw new FileSystemError(`File not found: ${path}`, FileSystemErrorCodes.NOT_FOUND, path);
    }

    if (stat.isDirectory()) {
      throw new FileSystemError(
        `Path is a directory: ${path}`,
        FileSystemErrorCodes.IS_DIRECTORY,
        path
      );
    }

    if (stat.size > maxBytes) {
      const fd = await fs.open(fullPath, 'r');
      try {
        const buffer = Buffer.alloc(maxBytes);
        await fd.read(buffer, 0, maxBytes, 0);
        return { content: buffer.toString('utf-8'), truncated: true, totalSize: stat.size };
      } finally {
        await fd.close();
      }
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    return { content, truncated: false, totalSize: stat.size };
  }

  async write(path: string, content: string): Promise<WriteResult> {
    const fullPath = this.resolvePath(path);

    const dir = dirname(fullPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      log.error('Failed to create directory', { dir, error: err });
      throw new FileSystemError(
        `Failed to create directory: ${dir}`,
        FileSystemErrorCodes.PERMISSION_DENIED,
        path
      );
    }

    try {
      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (err) {
      log.error('Failed to write file', { path, error: err });
      throw new FileSystemError(
        `Failed to write file: ${path}`,
        FileSystemErrorCodes.PERMISSION_DENIED,
        path
      );
    }

    const stat = await fs.stat(fullPath);
    return { success: true, bytesWritten: stat.size };
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileEntry | null> {
    try {
      const fullPath = this.resolvePath(path);
      const stat = await fs.stat(fullPath);
      return this.statToEntry(fullPath, stat);
    } catch {
      return null;
    }
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    return localSearch(this.projectPath, query, options);
  }

  async remove(
    path: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    return localRemove(this.resolvePath(path), path, options);
  }

  async saveAttachment(
    srcPath: string,
    subdir?: string
  ): Promise<{
    success: boolean;
    absPath?: string;
    relPath?: string;
    fileName?: string;
    error?: string;
  }> {
    return localSaveAttachment(this.projectPath, srcPath, subdir);
  }

  async readImage(path: string): Promise<{
    success: boolean;
    dataUrl?: string;
    mimeType?: string;
    size?: number;
    error?: string;
  }> {
    return localReadImage(this.resolvePath(path), path);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(this.resolvePath(dirPath), { recursive: options?.recursive ?? false });
  }

  async realPath(path: string): Promise<string> {
    return fs.realpath(this.resolvePath(path));
  }

  async glob(pattern: string, options?: { cwd?: string; dot?: boolean }): Promise<string[]> {
    const cwd = options?.cwd ? this.resolvePath(options.cwd) : this.projectPath;
    return glob(pattern, { cwd, dot: options?.dot ?? false, absolute: false });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(this.resolvePath(src), this.resolvePath(dest));
  }

  watch(
    callback: (events: FileWatchEvent[]) => void,
    options: { debounceMs?: number } = {}
  ): FileWatcher {
    return createLocalWatcher(this.projectPath, callback, options);
  }
}
