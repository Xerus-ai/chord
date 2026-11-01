import {
  MAX_REPO_ICON_IMAGE_BYTES,
  validateImageDataUri,
  type RepoIcon,
  type RepoIconImageSource,
} from '@shared/repo-icons';

/**
 * The format of a candidate icon is decided by its first bytes, never by its
 * name or by a server's `Content-Type`. A build script that wrote HTML to
 * `favicon.png`, or a proxy that labels an error page `image/png`, would
 * otherwise become a data URI the renderer draws as a broken image.
 *
 * Signature checks only — enough to reject a non-image without carrying a
 * decoder, which is all an `<img>` needs from us.
 */
type RepoIconImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp';

function startsWithBytes(buffer: Buffer, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
/** SOI marker. The next byte is always another marker's 0xff. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

function isWebpBuffer(buffer: Buffer): boolean {
  // RIFF container carrying the WEBP fourcc.
  return (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  );
}

export function detectRepoIconImageMimeType(buffer: Buffer): RepoIconImageMimeType | null {
  if (startsWithBytes(buffer, PNG_SIGNATURE)) return 'image/png';
  if (startsWithBytes(buffer, JPEG_SIGNATURE)) return 'image/jpeg';
  if (isWebpBuffer(buffer)) return 'image/webp';
  return null;
}

/**
 * Turns validated bytes into the icon that gets persisted, or `null` when the
 * bytes are not a supported image, are past the cap, or expand into a data URI
 * the column will not hold. Every `null` here means "this candidate is not
 * usable" — never "the probe failed".
 */
export function buildRepoIconFromImageBytes(
  buffer: Buffer,
  source: RepoIconImageSource
): RepoIcon | null {
  if (buffer.length === 0 || buffer.length > MAX_REPO_ICON_IMAGE_BYTES) return null;

  const mimeType = detectRepoIconImageMimeType(buffer);
  if (!mimeType) return null;

  const src = `data:${mimeType};base64,${buffer.toString('base64')}`;
  return validateImageDataUri(src) ? { type: 'image', src, source } : null;
}
