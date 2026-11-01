/**
 * One publish per artifact at a time. A publish writes the page and then
 * records the version it wrote; until it records, the page reads as ahead of
 * Chord's record — "Edited in Confluence" to a status read, and a refusal to
 * a second publish. Serialising publishes, and letting status reads wait for
 * the one in flight, closes that window.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** A publish that failed has already failed for its own caller; the next one runs regardless. */
function settle(publish: Promise<unknown> | undefined): Promise<void> {
  return (publish ?? Promise.resolve()).then(
    () => undefined,
    () => undefined
  );
}

export async function runPublishExclusively<T>(
  artifactId: string,
  publish: () => Promise<T>
): Promise<T> {
  const previous = inFlight.get(artifactId);
  const run = previous ? settle(previous).then(publish) : publish();
  inFlight.set(artifactId, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(artifactId) === run) inFlight.delete(artifactId);
  }
}

/** Resolves once no publish of the artifact is running (at once, when none is). */
export function waitForPublishInFlight(artifactId: string): Promise<void> {
  return settle(inFlight.get(artifactId));
}
