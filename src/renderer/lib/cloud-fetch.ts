/**
 * The one authenticated request to the cloud API: the bearer token (cached,
 * refreshed once on a 401) and server errors as `CloudApiError`.
 */

const CLOUD_API_BASE = import.meta.env.VITE_CLOUD_API_URL;

/**
 * The account's access token from the main process. `ipc` binds
 * `window.electronAPI` when it is imported, so it loads with the first
 * request: this module, and `CloudApiError` with it, import anywhere.
 */
async function readAccessToken(): Promise<string | null> {
  const { rpc } = await import('@renderer/lib/ipc');
  return rpc.account.getAccessToken();
}

let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_CACHE_TTL_MS = 4 * 60 * 1000;

async function getAuthToken(): Promise<string | null> {
  if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_CACHE_TTL_MS) {
    return cachedToken;
  }
  cachedToken = await readAccessToken();
  tokenFetchedAt = Date.now();
  return cachedToken;
}

export function clearCachedToken(): void {
  cachedToken = null;
  tokenFetchedAt = 0;
}

export class CloudApiError extends Error {
  readonly status: number;
  /** Machine-readable error code from the server body (e.g. SEAT_LIMIT_REACHED). */
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
  }
}

// Server error bodies are `{ error: string, code?: string }`. Surfacing the
// raw JSON in Error.message put strings like `Cloud API 403: {"error":...}`
// straight into the UI, so the human text and the code are pulled out here.
function toCloudApiError(status: number, body: string, statusText: string): CloudApiError {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; code?: unknown };
    if (typeof parsed.error === 'string') {
      return new CloudApiError(
        status,
        parsed.error,
        typeof parsed.code === 'string' ? parsed.code : null
      );
    }
  } catch {
    // Not JSON — fall through to the raw-text form.
  }
  return new CloudApiError(status, `Cloud API ${status}: ${body || statusText}`);
}

// 204-returning endpoints must be typed `cloudFetch<void>` — a body-bearing T
// here would be a lie: the resolved value is `undefined`, not a parsed body.
export async function cloudFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();

  const res = await fetch(`${CLOUD_API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    clearCachedToken();
    const retryToken = await readAccessToken();
    if (retryToken) {
      cachedToken = retryToken;
      tokenFetchedAt = Date.now();
      const retry = await fetch(`${CLOUD_API_BASE}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${retryToken}`,
          ...init?.headers,
        },
      });
      if (retry.ok) {
        if (retry.status === 204) return undefined as T;
        return retry.json() as Promise<T>;
      }
      const retryBody = await retry.text().catch(() => '');
      throw toCloudApiError(retry.status, retryBody, retry.statusText);
    }
    throw new CloudApiError(401, 'Cloud API: unauthorized — sign in required');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw toCloudApiError(res.status, body, res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
