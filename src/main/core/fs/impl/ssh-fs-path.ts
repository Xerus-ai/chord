import { FileSystemError, FileSystemErrorCodes } from '../types';

export function resolveRemotePath(remotePath: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');

  if (normalized.startsWith('/')) {
    const resolved = normalizePosixPath(normalized);
    if (!isWithinBase(remotePath, resolved)) {
      throw new FileSystemError(
        'Path traversal detected: path escapes base directory',
        FileSystemErrorCodes.PATH_ESCAPE,
        relPath
      );
    }
    return resolved;
  }

  const joined = `${remotePath}/${normalized}`.replace(/\/+/g, '/');
  const fullPath = normalizePosixPath(joined);

  if (!isWithinBase(remotePath, fullPath)) {
    throw new FileSystemError(
      'Path traversal detected: path escapes base directory',
      FileSystemErrorCodes.PATH_ESCAPE,
      relPath
    );
  }

  return fullPath;
}

export function normalizePosixPath(p: string): string {
  const parts = p.split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '.') continue;
    out.push(seg);
  }
  return out.join('/').replace(/\/+/g, '/') || '/';
}

export function isWithinBase(remotePath: string, fullPath: string): boolean {
  const normalizedPath = fullPath.replace(/\/+/g, '/').replace(/\/$/, '');
  const normalizedBase = remotePath.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
}

export function relativePath(remotePath: string, fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/');
  const normalizedBase = remotePath.replace(/\\/g, '/');

  if (normalized === normalizedBase) {
    return '';
  }

  const prefix = `${normalizedBase}/`;
  if (normalized.startsWith(prefix)) {
    return normalized.substring(prefix.length);
  }

  return normalized;
}
