/**
 * A repo's identity across machines (shared-items step 3, decision 5): its
 * origin as `host/path`, lowercased, without scheme, user, credentials, port
 * or `.git`. The owner's clone and a teammate's may spell the same remote over
 * ssh or https in any case; normalized, matching is plain equality. This is
 * the only form the cloud stores (`work_items.repo_remote_url`).
 *
 * `null` for anything that names no shared repo: a local path, a `file://`
 * url, or a host with no repo path.
 */
export function normalizeRemoteUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const location = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? readUrlRemote(value)
    : readScpRemote(value);
  if (!location) return null;

  const path = location.path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  if (!location.host || !path) return null;
  return `${location.host}/${path}`.toLowerCase();
}

const REMOTE_SCHEMES = new Set(['ssh:', 'git:', 'http:', 'https:', 'git+ssh:', 'ssh+git:']);

function readUrlRemote(value: string): { host: string; path: string } | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!REMOTE_SCHEMES.has(url.protocol.toLowerCase())) return null;
  return { host: url.hostname, path: decodeURIComponent(url.pathname) };
}

/**
 * git's scp-like syntax, `[user@]host:path`. git reads it only when no slash
 * comes before the first colon; a drive letter (`C:\repo`, `C:/repo`) is a
 * local path, as it is to git on Windows.
 */
function readScpRemote(value: string): { host: string; path: string } | null {
  const match = /^(?:[^@/\\\s]+@)?([^:/\\\s]+):(.+)$/.exec(value);
  if (!match) return null;
  const [, host, path] = match;
  if (/^[a-z]$/i.test(host)) return null;
  if (path.startsWith('\\')) return null;
  return { host, path };
}
