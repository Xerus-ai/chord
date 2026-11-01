import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { loadRepoFileAt } from './prepare-repo-file';

/**
 * A repo's pdf, docx, pptx or image previews through the same viewers as a
 * binary artifact (design 2026-09-26 §3, 2026-09-24 §10), read from the
 * checkout — "Open" opens the file itself.
 */
let checkout: string;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), 'chord-repo-bin-'));
  writeFileSync(join(checkout, 'logo.png'), PNG);
  writeFileSync(join(checkout, 'main.ts'), 'x');
});

afterAll(() => removeDirSync(checkout));

describe('loadRepoFileAt', () => {
  it('reads a binary file with its MIME type, as the file on disk', () => {
    expect(loadRepoFileAt(checkout, 'logo.png')).toEqual({
      fileName: 'logo.png',
      mimeType: 'image/png',
      bytes: PNG,
      versionId: null,
      versionNumber: null,
      diskPath: join(checkout, 'logo.png'),
    });
  });

  it('refuses a file that is no binary format, and a path outside the checkout', () => {
    expect(() => loadRepoFileAt(checkout, 'main.ts')).toThrow(/not a binary/);
    expect(() => loadRepoFileAt(checkout, '../logo.png')).toThrow(/outside/);
  });
});
