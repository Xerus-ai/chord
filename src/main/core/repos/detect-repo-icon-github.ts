import type { RepoIconDetectionOutcome } from '@shared/repo-icon-detection';
import { MAX_REPO_ICON_IMAGE_BYTES } from '@shared/repo-icons';
import type { ParsedGitRemote } from '@main/core/issues/git-remote-resolver';
import { buildRepoIconFromImageBytes } from './repo-icon-image-bytes';

/** GHES avatars live on the same `/<login>.png` path github.com uses. */
const GITHUB_AVATAR_SIZE = 64;

/** Conservative GitHub login shape — no separators, so the path cannot be steered. */
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Public gTLDs that cannot be the second label of a GitHub Enterprise host.
 * `github.com.evil.example` starts with `github.` and is not GitHub; a private
 * GHES name (`github.acme.corp`) never has a gTLD there.
 */
const PUBLIC_SECOND_LABELS = new Set(['com', 'net', 'org', 'io', 'co', 'dev', 'app']);

/**
 * github.com, or a GitHub Enterprise host — which by convention is a private
 * `github.<corp-domain>` name. Everything else is refused: `<login>.png` means
 * nothing on gitlab.com or bitbucket.org, and a request there would publish the
 * repository's existence to an unrelated server.
 */
function isGitHubAvatarHost(host: string): boolean {
  const labels = host.toLowerCase().split('.');
  if (labels[0] !== 'github') return false;
  if (labels.length === 2) return labels[1] === 'com';
  return labels.length > 2 && !PUBLIC_SECOND_LABELS.has(labels[1] ?? '');
}

/**
 * The avatar URL for the owner of a parsed `origin` remote, or `null` when this
 * remote has no GitHub owner to ask about. `null` is a definitive "nothing to
 * probe" — the caller reads it as `none`, not as a failure.
 *
 * `avatarOrigin` exists so tests can point the fetch at a loopback server;
 * production passes nothing and gets the remote's own host.
 */
export function buildGitHubAvatarUrl(
  remote: ParsedGitRemote,
  avatarOrigin?: string
): string | null {
  if (!isGitHubAvatarHost(remote.host)) return null;

  const segments = remote.slug.split('/');
  if (segments.length !== 2) return null;

  const [owner, repo] = segments;
  if (!GITHUB_LOGIN_RE.test(owner) || !repo) return null;

  const origin = avatarOrigin ?? `https://${remote.host}`;
  return `${origin}/${encodeURIComponent(owner)}.png?size=${GITHUB_AVATAR_SIZE}`;
}

const DEFAULT_AVATAR_TIMEOUT_MS = 8_000;

/**
 * Fetches an owner avatar in the MAIN process and inlines it, so the renderer
 * never dials github.com itself: hot-linking would publish the user's repo list
 * to GitHub on every window open, and a `data:` URI survives going offline.
 *
 * The status code decides the persist rule. 404 is GitHub answering "no such
 * avatar" — definitive, so `none`. Anything else non-OK, a timeout, or a
 * transport error is `failed`, which persists nothing and is retried.
 */
export async function fetchGitHubAvatarIcon(
  avatarUrl: string,
  options?: { timeoutMs?: number }
): Promise<RepoIconDetectionOutcome> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_AVATAR_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(avatarUrl, { signal: controller.signal, redirect: 'follow' });
    if (response.status === 404) return { kind: 'none' };
    if (!response.ok) {
      return { kind: 'failed', error: `${avatarUrl} answered ${response.status}` };
    }

    // Bail on a declared size before reading the body, so a mislabelled URL
    // cannot make us buffer megabytes for a 64px avatar.
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REPO_ICON_IMAGE_BYTES) {
      return { kind: 'none' };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REPO_ICON_IMAGE_BYTES) return { kind: 'none' };

    const icon = buildRepoIconFromImageBytes(buffer, 'github');
    // A 200 whose body is not a usable image is still a complete answer.
    return icon ? { kind: 'found', icon } : { kind: 'none' };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      kind: 'failed',
      error: aborted ? `${avatarUrl} timed out after ${timeoutMs}ms` : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
