import { promises as fs } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

export async function localRemove(
  fullPath: string,
  path: string,
  options?: { recursive?: boolean }
): Promise<{ success: boolean; error?: string }> {
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    return { success: false, error: `File not found: ${path}` };
  }

  if (stat.isDirectory()) {
    if (!options?.recursive) {
      return { success: false, error: `Path is a directory: ${path}` };
    }
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    await fs.unlink(fullPath);
    return { success: true };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      try {
        await fs.chmod(fullPath, 0o666);
        await fs.unlink(fullPath);
        return { success: true };
      } catch {
        return { success: false, error: `Permission denied: ${path}` };
      }
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function localSaveAttachment(
  projectPath: string,
  srcPath: string,
  subdir?: string
): Promise<{
  success: boolean;
  absPath?: string;
  relPath?: string;
  fileName?: string;
  error?: string;
}> {
  const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.bmp',
    '.svg',
  ]);

  try {
    try {
      await fs.access(srcPath);
    } catch {
      return { success: false, error: 'Source file not found' };
    }

    const ext = extname(srcPath).toLowerCase();
    if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)) {
      return { success: false, error: 'Unsupported attachment type' };
    }

    const destDir = join(projectPath, '.chord', subdir ?? 'attachments');
    await fs.mkdir(destDir, { recursive: true });

    const baseName = basename(srcPath);
    let destName = baseName;
    let counter = 1;
    let destAbs = join(destDir, destName);

    while (true) {
      try {
        await fs.access(destAbs);
        const nameWithoutExt = basename(baseName, ext);
        destName = `${nameWithoutExt}-${counter}${ext}`;
        destAbs = join(destDir, destName);
        counter++;
      } catch {
        break;
      }
    }

    await fs.copyFile(srcPath, destAbs);
    const relPath = relative(projectPath, destAbs);
    return { success: true, absPath: destAbs, relPath, fileName: destName };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function localReadImage(
  fullPath: string,
  path: string
): Promise<{
  success: boolean;
  dataUrl?: string;
  mimeType?: string;
  size?: number;
  error?: string;
}> {
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return {
      success: false,
      error: `Unsupported image format: ${ext}. Allowed: ${Array.from(ALLOWED_IMAGE_EXTENSIONS).join(', ')}`,
    };
  }

  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    return { success: false, error: `Image not found: ${path}` };
  }

  if (stat.isDirectory()) {
    return { success: false, error: `Path is a directory: ${path}` };
  }

  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
  if (stat.size > MAX_IMAGE_SIZE) {
    return {
      success: false,
      error: `Image too large: ${stat.size} bytes (max ${MAX_IMAGE_SIZE})`,
    };
  }

  try {
    const buffer = await fs.readFile(fullPath);
    const base64 = buffer.toString('base64');
    const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return { success: true, dataUrl, mimeType, size: stat.size };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
