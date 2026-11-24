/**
 * Whether the CI workflow (`.github/workflows/ci.yml`) has any run, in any state, for `sha` in
 * `repo` (owner/name), from GitHub's Actions API with `token`. A release merge whose push event
 * GitHub lost has none. Throws when GitHub cannot be read or answers other than 200: the release
 * decision needs a reading.
 */
export async function readCiRan(
  repo: string,
  token: string,
  sha: string,
  timeoutMs = 20_000
): Promise<boolean> {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&per_page=1`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? (error.cause ?? error.message) : error;
    throw new Error(`cannot read the CI runs of ${sha}: ${String(reason)}`);
  }
  if (response.status !== 200) {
    throw new Error(`GitHub answered ${response.status} for the CI runs of ${sha}`);
  }
  const body = (await response.json()) as { total_count?: unknown };
  if (typeof body.total_count !== 'number') {
    throw new Error(`GitHub sent no total_count for the CI runs of ${sha}`);
  }
  return body.total_count > 0;
}
