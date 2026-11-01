/**
 * GitHub answering 401/403 means the token itself is no longer good — a real
 * signed-out answer. Every other failure (offline, DNS, 5xx, timeout) says
 * nothing about the token and must not be read as a disconnect.
 */
export function isTokenRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
}
