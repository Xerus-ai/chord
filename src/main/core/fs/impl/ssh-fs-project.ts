import type { SFTPWrapper } from 'ssh2';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { FileEntry } from '../types';
import { ALLOWED_IMAGE_EXTENSIONS, mapSftpError } from './ssh-fs-errors';

export async function sshRemove(
  path: string,
  fullPath: string,
  options: { recursive?: boolean } | undefined,
  statFn: (p: string) => Promise<FileEntry | null>,
  getSftp: () => Promise<SFTPWrapper>,
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): Promise<{ success: boolean; error?: string }> {
  try {
    const entry = await statFn(path);
    if (!entry) {
      return { success: false, error: `File not found: ${path}` };
    }

    const sftp = await getSftp();

    if (entry.type === 'dir') {
      if (!options?.recursive) {
        return { success: false, error: `Path is a directory: ${path}` };
      }
      const command = `rm -rf ${quoteShellArg(fullPath)}`;
      const result = await exec(command);

      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr || 'Failed to remove directory' };
      }
    } else {
      return new Promise((resolve) => {
        sftp.unlink(fullPath, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true });
          }
        });
      });
    }

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

export async function sshReadImage(
  path: string,
  fullPath: string,
  sftp: SFTPWrapper
): Promise<{
  success: boolean;
  dataUrl?: string;
  mimeType?: string;
  size?: number;
  error?: string;
}> {
  const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
  if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
    return { success: false, error: `Unsupported image format: ${ext}` };
  }

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

        const maxImageSize = 5 * 1024 * 1024;
        if (stats.size > maxImageSize) {
          sftp.close(handle, () => {});
          resolve({
            success: false,
            error: `Image too large: ${stats.size} bytes (max ${maxImageSize})`,
          });
          return;
        }

        if (stats.size === 0) {
          sftp.close(handle, () => {});
          resolve({ success: false, error: 'Image file is empty' });
          return;
        }

        const buffer = Buffer.alloc(stats.size);

        sftp.read(handle, buffer, 0, stats.size, 0, (readErr) => {
          sftp.close(handle, () => {});

          if (readErr) {
            reject(mapSftpError(readErr, fullPath));
            return;
          }

          const mimeTypes: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.bmp': 'image/bmp',
            '.ico': 'image/x-icon',
          };
          const mimeType = mimeTypes[ext] || 'application/octet-stream';
          const base64 = buffer.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64}`;

          resolve({ success: true, dataUrl, mimeType, size: stats.size });
        });
      });
    });
  });
}
