import { describe, expect, it } from 'vitest';
import {
  isRepoIconKey,
  MAX_REPO_ICON_DATA_URI_LENGTH,
  parseRepoIcon,
  REPO_ICON_KEYS,
  serializeRepoIcon,
  validateImageDataUri,
  type RepoIcon,
} from './repo-icons';

/**
 * The keys are persisted in `repos.icon`, so they are the contract between the
 * database and whatever component map the renderer happens to use today. The
 * shape rules are asserted here because a lucide COMPONENT name sneaking into
 * the list (`FolderIcon`) would still typecheck and still render — and would
 * then be impossible to rename without a data migration.
 */
describe('repo icon keys', () => {
  it('ships a fixed set of distinct lower-case identifiers', () => {
    expect(REPO_ICON_KEYS.length).toBeGreaterThanOrEqual(16);
    expect(new Set(REPO_ICON_KEYS).size).toBe(REPO_ICON_KEYS.length);
    for (const key of REPO_ICON_KEYS) expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('accepts every key it ships', () => {
    for (const key of REPO_ICON_KEYS) expect(isRepoIconKey(key)).toBe(true);
  });

  it('rejects anything that is not one of them', () => {
    const rejected: unknown[] = [
      '',
      ' ',
      'folder ',
      'Folder',
      'FolderIcon',
      'not-an-icon',
      null,
      undefined,
      0,
      42,
      true,
      {},
      ['folder'],
      () => 'folder',
    ];
    for (const value of rejected) expect(isRepoIconKey(value)).toBe(false);
  });
});

/** A 1×1 PNG — real bytes, so the prefix and the base64 alphabet are both real. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const PNG_DATA_URI = `data:image/png;base64,${PNG_BASE64}`;

function dataUriOfLength(length: number): string {
  const prefix = 'data:image/png;base64,';
  // Base64 payloads come in quads; pad to the requested total length.
  return prefix + 'A'.repeat(Math.max(0, length - prefix.length));
}

describe('validateImageDataUri', () => {
  it('accepts the three raster types a detected icon may be', () => {
    expect(validateImageDataUri(PNG_DATA_URI)).toBe(true);
    expect(validateImageDataUri(`data:image/jpeg;base64,${PNG_BASE64}`)).toBe(true);
    expect(validateImageDataUri(`data:image/webp;base64,${PNG_BASE64}`)).toBe(true);
  });

  it('rejects a non-data URI, a remote URL, and a foreign mime type', () => {
    expect(validateImageDataUri('https://github.com/torvalds.png')).toBe(false);
    expect(validateImageDataUri('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(validateImageDataUri('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe(false);
    expect(validateImageDataUri('data:text/plain;base64,aGk=')).toBe(false);
  });

  it('rejects a data URI that is not base64-encoded or is empty', () => {
    expect(validateImageDataUri('data:image/png,notbase64')).toBe(false);
    expect(validateImageDataUri('data:image/png;base64,')).toBe(false);
    expect(validateImageDataUri('data:image/png;base64,not base64!!')).toBe(false);
  });

  it('rejects anything that is not a string', () => {
    expect(validateImageDataUri(null)).toBe(false);
    expect(validateImageDataUri(undefined)).toBe(false);
    expect(validateImageDataUri(42)).toBe(false);
    expect(validateImageDataUri({ src: PNG_DATA_URI })).toBe(false);
  });

  it('accepts a data URI at the cap and rejects one past it', () => {
    expect(validateImageDataUri(dataUriOfLength(MAX_REPO_ICON_DATA_URI_LENGTH))).toBe(true);
    expect(validateImageDataUri(dataUriOfLength(MAX_REPO_ICON_DATA_URI_LENGTH + 1))).toBe(false);
  });
});

/**
 * `repos.icon` now carries a JSON-encoded `RepoIcon`, so serialize/parse is the
 * database boundary. `parseRepoIcon` throws rather than degrading: a row this
 * build cannot read means a newer build wrote it or the column was tampered
 * with, and silently drawing the letter tile would hide that forever.
 */
describe('repo icon serialization', () => {
  const variants: RepoIcon[] = [
    { type: 'lucide', key: REPO_ICON_KEYS[0] },
    { type: 'image', src: PNG_DATA_URI, source: 'file' },
    { type: 'image', src: PNG_DATA_URI, source: 'github' },
    { type: 'letter' },
  ];

  it('round-trips every variant', () => {
    for (const icon of variants) {
      expect(parseRepoIcon(serializeRepoIcon(icon))).toEqual(icon);
    }
  });

  it('serializes to JSON a SQLite text column can hold', () => {
    expect(JSON.parse(serializeRepoIcon({ type: 'letter' }))).toEqual({ type: 'letter' });
  });

  it('throws on malformed JSON', () => {
    expect(() => parseRepoIcon('')).toThrow(/repo icon/i);
    expect(() => parseRepoIcon('folder')).toThrow(/repo icon/i);
    expect(() => parseRepoIcon('{"type":')).toThrow(/repo icon/i);
  });

  it('throws on JSON that is not an object', () => {
    expect(() => parseRepoIcon('null')).toThrow(/repo icon/i);
    expect(() => parseRepoIcon('42')).toThrow(/repo icon/i);
    expect(() => parseRepoIcon('"letter"')).toThrow(/repo icon/i);
    expect(() => parseRepoIcon('[{"type":"letter"}]')).toThrow(/repo icon/i);
  });

  it('throws on an unknown discriminant', () => {
    expect(() => parseRepoIcon('{"type":"emoji","emoji":"🚀"}')).toThrow(/emoji/);
    expect(() => parseRepoIcon('{"key":"folder"}')).toThrow(/repo icon/i);
  });

  it('throws on a lucide key this build does not ship', () => {
    expect(() => parseRepoIcon('{"type":"lucide","key":"retired_icon"}')).toThrow(/retired_icon/);
    expect(() => parseRepoIcon('{"type":"lucide","key":"FolderIcon"}')).toThrow(/FolderIcon/);
    expect(() => parseRepoIcon('{"type":"lucide"}')).toThrow(/lucide/i);
  });

  it('throws on an image whose src is not an accepted data URI', () => {
    expect(() =>
      parseRepoIcon('{"type":"image","src":"https://github.com/torvalds.png","source":"github"}')
    ).toThrow(/data uri/i);
    expect(() =>
      parseRepoIcon('{"type":"image","src":"data:image/svg+xml;base64,PHN2Zz4=","source":"file"}')
    ).toThrow(/data uri/i);
    expect(() => parseRepoIcon('{"type":"image","source":"file"}')).toThrow(/data uri/i);
  });

  it('throws on an image whose data URI is past the length cap', () => {
    const oversized = JSON.stringify({
      type: 'image',
      src: dataUriOfLength(MAX_REPO_ICON_DATA_URI_LENGTH + 1),
      source: 'file',
    });

    expect(() => parseRepoIcon(oversized)).toThrow(/data uri/i);
  });

  it('throws on an image whose source is not one of the detected ones', () => {
    expect(() =>
      parseRepoIcon(JSON.stringify({ type: 'image', src: PNG_DATA_URI, source: 'upload' }))
    ).toThrow(/upload/);
    expect(() =>
      parseRepoIcon(JSON.stringify({ type: 'image', src: PNG_DATA_URI, source: 'favicon' }))
    ).toThrow(/favicon/);
    expect(() => parseRepoIcon(JSON.stringify({ type: 'image', src: PNG_DATA_URI }))).toThrow(
      /source/i
    );
  });
});
