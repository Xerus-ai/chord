import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { LocalFileSystem } from './local-fs';

describe('LocalFileSystem', () => {
  let tempDir: string;
  let fsService: LocalFileSystem;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'));
    fsService = new LocalFileSystem(tempDir);
  });

  afterEach(() => {
    removeDirSync(tempDir);
  });

  describe('remove', () => {
    it('should remove file', async () => {
      fs.writeFileSync(path.join(tempDir, 'delete.txt'), 'content');

      const result = await fsService.remove('delete.txt');

      expect(result.success).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'delete.txt'))).toBe(false);
    });

    it('should fail when file not found', async () => {
      const result = await fsService.remove('nonexistent.txt');

      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should fail when path is directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const result = await fsService.remove('subdir');

      expect(result.success).toBe(false);
      expect(result.error).toContain('directory');
    });

    it('should retry with chmod on permission error', async () => {
      if (process.platform !== 'win32') {
        const filePath = path.join(tempDir, 'readonly.txt');
        fs.writeFileSync(filePath, 'content');
        fs.chmodSync(filePath, 0o444);

        try {
          const result = await fsService.remove('readonly.txt');
          expect(result.success).toBe(true);
        } finally {
          // Restore permissions for cleanup
          try {
            fs.chmodSync(filePath, 0o666);
          } catch {
            // Ignore
          }
        }
      }
    });
  });

  describe('readImage', () => {
    it('should read image as data URL', async () => {
      // Create a minimal valid PNG file (1x1 transparent pixel)
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      fs.writeFileSync(path.join(tempDir, 'test.png'), pngBuffer);

      const result = await fsService.readImage('test.png');

      expect(result.success).toBe(true);
      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(pngBuffer.length);
    });

    it('should reject unsupported image formats', async () => {
      // bmp is not in the allowed list
      fs.writeFileSync(path.join(tempDir, 'test.xyz'), 'fake-data');

      const result = await fsService.readImage('test.xyz');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported image format');
    });

    it('should fail when image not found', async () => {
      const result = await fsService.readImage('nonexistent.png');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail when path is directory', async () => {
      fs.mkdirSync(path.join(tempDir, 'images'));

      // Directories don't have extensions, so this will fail with unsupported format
      // or directory error depending on implementation order
      const result = await fsService.readImage('images');

      expect(result.success).toBe(false);
    });

    it('should reject oversized images', async () => {
      // Create a fake large "image" file
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB
      fs.writeFileSync(path.join(tempDir, 'large.png'), largeBuffer);

      const result = await fsService.readImage('large.png');

      expect(result.success).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('path traversal protection', () => {
    it('should block absolute path traversal', async () => {
      // Absolute paths get normalized by resolvePath
      await expect(fsService.read('/etc/passwd')).rejects.toThrow();
    });

    it('should block relative path traversal', async () => {
      await expect(fsService.read('../package.json')).rejects.toThrow();
    });

    it('should block nested path traversal', async () => {
      fs.mkdirSync(path.join(tempDir, 'subdir'));
      fs.writeFileSync(path.join(tempDir, 'subdir/file.txt'), 'content');

      await expect(fsService.read('subdir/../../../etc/passwd')).rejects.toThrow();
    });

    it('should normalize paths with double slashes', async () => {
      fs.writeFileSync(path.join(tempDir, 'test.txt'), 'content');

      const result = await fsService.read('//test.txt');

      expect(result.content).toBe('content');
    });

    it('should allow valid subpaths', async () => {
      fs.mkdirSync(path.join(tempDir, 'valid'));
      fs.mkdirSync(path.join(tempDir, 'valid/nested'));
      fs.writeFileSync(path.join(tempDir, 'valid/nested/file.txt'), 'content');

      const result = await fsService.read('valid/nested/file.txt');

      expect(result.content).toBe('content');
    });
  });

  describe('large file handling', () => {
    it('should handle files larger than default maxBytes', async () => {
      const largeContent = 'x'.repeat(500 * 1024); // 500KB
      fs.writeFileSync(path.join(tempDir, 'large.txt'), largeContent);

      const result = await fsService.read('large.txt');

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(200 * 1024); // Default limit
    });

    it('should handle custom maxBytes limit', async () => {
      const content = 'x'.repeat(100);
      fs.writeFileSync(path.join(tempDir, 'medium.txt'), content);

      const result = await fsService.read('medium.txt', 50);

      expect(result.truncated).toBe(true);
      expect(result.content.length).toBe(50);
    });
  });
});
