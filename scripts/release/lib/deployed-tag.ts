const RELEASE_TAG = /^v\d+\.\d+\.\d+(-canary\.\d+)?$/;

/**
 * The release tag the live sync server runs, from its /health `version` (the deploy's
 * CHORD_RELEASE_TAG; null outside a deploy). Throws when the server cannot be reached, answers
 * other than 200, or reports something that is not a release tag: the release decision needs it.
 */
export async function readDeployedTag(
  healthUrl: string,
  timeoutMs = 20_000
): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = error instanceof Error ? (error.cause ?? error.message) : error;
    throw new Error(`cannot read ${healthUrl}: ${String(reason)}`);
  }
  if (response.status !== 200) {
    throw new Error(`${healthUrl} answered ${response.status}, not a health reading`);
  }
  const body = (await response.json()) as { version?: unknown };
  if (body.version === null) return null;
  if (typeof body.version !== 'string' || !RELEASE_TAG.test(body.version)) {
    throw new Error(
      `${healthUrl} reports version ${JSON.stringify(body.version)}, not a release tag`
    );
  }
  return body.version;
}
