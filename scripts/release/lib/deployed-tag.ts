const RELEASE_TAG = /^v\d+\.\d+\.\d+(-canary\.\d+)?$/;

/**
 * The release tag the live sync server runs, from its /health `version` (the deploy's
 * CHORD_RELEASE_TAG). Null when it runs no release: no version outside a deploy, or a version
 * that is not a release tag (a rehearsal deploy such as v0.0.0-5s42.4); the release then deploys
 * the server. Throws when the server cannot be reached, answers other than 200, or sends no
 * string or null `version`: the release decision needs a reading.
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
  if (typeof body.version !== 'string') {
    throw new Error(
      `${healthUrl} reports version ${JSON.stringify(body.version)}, not a health reading`
    );
  }
  return RELEASE_TAG.test(body.version) ? body.version : null;
}
