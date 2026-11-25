/** A run that never tested the commit: ci.yml cancels a main run when another merge lands. */
const NO_RUN = new Set(['cancelled', 'skipped']);

/**
 * Whether the CI workflow (`.github/workflows/ci.yml`) ran on `sha` in `repo` (owner/name), from
 * GitHub's Actions API at `apiBase` with `token`: a queued, running, passed or failed run counts;
 * a cancelled or skipped one does not, nor does none at all (a release merge whose push event
 * GitHub lost). Throws when the API cannot be read, answers other than 200, or sends no
 * workflow_runs: the release decision needs a reading.
 */
export async function readCiRan(
  apiBase: string,
  repo: string,
  token: string,
  sha: string,
  timeoutMs = 20_000
): Promise<boolean> {
  const url = `${apiBase}/repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&per_page=100`;
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
  const body = (await response.json()) as { workflow_runs?: unknown };
  if (!Array.isArray(body.workflow_runs)) {
    throw new Error(`GitHub sent no workflow_runs for the CI runs of ${sha}`);
  }
  return (body.workflow_runs as { conclusion?: string | null }[]).some(
    (run) => !NO_RUN.has(run.conclusion ?? '')
  );
}
