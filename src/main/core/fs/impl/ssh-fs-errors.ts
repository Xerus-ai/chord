import { FileSystemError, FileSystemErrorCodes } from '../types';

export const SFTP_STATUS = {
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
} as const;

export interface SftpError extends Error {
  code?: number;
}

export const ALLOWED_IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
];

export const MAX_READ_SIZE = 100 * 1024 * 1024;
export const DEFAULT_MAX_BYTES = 200 * 1024;

export function mapSftpError(error: unknown, path?: string): FileSystemError {
  const sftpErr = error as SftpError;
  const message = typeof sftpErr?.message === 'string' ? sftpErr.message : String(error);
  const code = sftpErr?.code;

  if (code === SFTP_STATUS.NO_SUCH_FILE || message.includes('No such file')) {
    return new FileSystemError(
      `File or directory not found: ${path || message}`,
      FileSystemErrorCodes.NOT_FOUND,
      path
    );
  }

  if (code === SFTP_STATUS.PERMISSION_DENIED || message.includes('Permission denied')) {
    return new FileSystemError(
      `Permission denied: ${path || message}`,
      FileSystemErrorCodes.PERMISSION_DENIED,
      path
    );
  }

  if (message.includes('is a directory')) {
    return new FileSystemError(
      `Path is a directory: ${path || message}`,
      FileSystemErrorCodes.IS_DIRECTORY,
      path
    );
  }

  if (message.includes('Not a directory')) {
    return new FileSystemError(
      `Path is not a directory: ${path || message}`,
      FileSystemErrorCodes.NOT_DIRECTORY,
      path
    );
  }

  if (message.includes('connection') || message.includes('Connection')) {
    return new FileSystemError(
      `Connection error: ${message}`,
      FileSystemErrorCodes.CONNECTION_ERROR,
      path
    );
  }

  return new FileSystemError(`Filesystem error: ${message}`, FileSystemErrorCodes.UNKNOWN, path);
}
