/**
 * The icons a repository may wear in the sidebar.
 *
 * These keys are persisted in `repos.icon`, so they are stable identifiers and
 * deliberately NOT lucide component names: renaming or swapping the component
 * behind `terminal` must not need a data migration, and an install that was
 * written by a newer build must not be able to put an arbitrary string on the
 * import path of a component map. The key → component map lives in the
 * renderer, next to the tile that draws it.
 *
 * Chosen for what a codebase actually is — language, runtime, shape of the
 * thing being built — rather than for decoration.
 */
export const REPO_ICON_KEYS = [
  'folder',
  'code',
  'terminal',
  'bot',
  'package',
  'database',
  'globe',
  'server',
  'cpu',
  'layers',
  'box',
  'rocket',
  'flask',
  'book',
  'wrench',
  'smartphone',
  'cloud',
  'shield',
  'palette',
  'zap',
] as const;

export type RepoIconKey = (typeof REPO_ICON_KEYS)[number];

const REPO_ICON_KEY_SET: ReadonlySet<string> = new Set<string>(REPO_ICON_KEYS);

/**
 * The only way a value becomes a `RepoIconKey`. Guards both the RPC boundary
 * (what the picker sends) and the read path (what an older or newer build left
 * in the column).
 */
export function isRepoIconKey(value: unknown): value is RepoIconKey {
  return typeof value === 'string' && REPO_ICON_KEY_SET.has(value);
}

/** Where a detected image came from. There is no `'upload'`: the app has no
 *  upload path, and adding a member here would be how one arrives by accident. */
export type RepoIconImageSource = 'file' | 'github';

/**
 * What a repository wears in the sidebar.
 *
 * `repos.icon` holds this as JSON, and the three variants are not
 * interchangeable with the column being NULL:
 *
 * - SQL `NULL` — never probed. Detection is still owed and will run.
 * - `{ type: 'letter' }` — probed, definitively nothing found (or the user reset
 *   it). Settled: the letter tile is the answer and re-probing is not.
 * - `{ type: 'lucide' }` / `{ type: 'image' }` — an icon to draw.
 *
 * A failed probe writes NOTHING, which is why `letter` has to be a value the
 * column can hold rather than being spelled as absence.
 */
export type RepoIcon =
  | { type: 'lucide'; key: RepoIconKey }
  | { type: 'image'; src: string; source: RepoIconImageSource }
  | { type: 'letter' };

/**
 * What the icon picker may submit over `repos.setIcon`.
 *
 * `image` is absent on purpose. The app has no upload path, so an image icon
 * can only ever be produced by detection in the main process; accepting one
 * over the RPC would be an upload path by the back door, and would let the
 * renderer put an arbitrary `data:` URI into a column the sidebar feeds
 * straight to an `<img>`.
 */
export type RepoIconChoice = { type: 'lucide'; key: RepoIconKey } | { type: 'letter' };

/** Raw bytes ceiling for a detected image, before base64 expands it. */
export const MAX_REPO_ICON_IMAGE_BYTES = 256 * 1024;

/**
 * Ceiling on the persisted `data:` URI. Larger than
 * `MAX_REPO_ICON_IMAGE_BYTES` × 4/3 on purpose: the byte cap is what the
 * producers enforce, and this is the independent cap on what the column may
 * hold, so a row is never trusted just because it was written by a producer.
 */
export const MAX_REPO_ICON_DATA_URI_LENGTH = 400 * 1024;

const IMAGE_DATA_URI_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * Whether a string is an inline raster image this app is willing to persist and
 * hand to an `<img>`. Pure, and the only definition of that: the renderer's CSP
 * allows `data:` images, so this is what stands between the column and the DOM.
 *
 * `svg` is deliberately absent — an inline SVG is a script-capable document.
 */
export function validateImageDataUri(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length <= MAX_REPO_ICON_DATA_URI_LENGTH &&
    IMAGE_DATA_URI_RE.test(value)
  );
}

export function serializeRepoIcon(icon: RepoIcon): string {
  return JSON.stringify(icon);
}

/**
 * Reads what is in `repos.icon`. Throws on anything it does not recognise
 * rather than degrading to the letter tile: the column is only ever written by
 * `serializeRepoIcon`, so an unreadable value means a newer build wrote it or
 * the file was edited by hand — and silently drawing a letter would hide either
 * for as long as the install lives.
 */
export function parseRepoIcon(text: string): RepoIcon {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Malformed repo icon: ${text.slice(0, 64)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Malformed repo icon: expected an object, got ${text.slice(0, 64)}`);
  }

  const candidate = parsed as { type?: unknown; key?: unknown; src?: unknown; source?: unknown };
  switch (candidate.type) {
    case 'letter':
      return { type: 'letter' };
    case 'lucide': {
      if (!isRepoIconKey(candidate.key)) {
        throw new Error(`Unknown repo icon lucide key: ${String(candidate.key)}`);
      }
      return { type: 'lucide', key: candidate.key };
    }
    case 'image': {
      if (!validateImageDataUri(candidate.src)) {
        throw new Error(
          `Repo icon image src is not an accepted data URI (${String(candidate.src).slice(0, 32)}…)`
        );
      }
      if (candidate.source !== 'file' && candidate.source !== 'github') {
        throw new Error(`Unknown repo icon image source: ${String(candidate.source)}`);
      }
      return { type: 'image', src: candidate.src as string, source: candidate.source };
    }
    default:
      throw new Error(`Unknown repo icon type: ${String(candidate.type)}`);
  }
}
