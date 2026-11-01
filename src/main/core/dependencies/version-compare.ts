const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(version: string): [number, number, number] {
  const match = PLAIN_VERSION.exec(version);
  if (!match) throw new Error(`Not an X.Y.Z version: ${JSON.stringify(version)}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Orders two `X.Y.Z` versions part by part: -1 when `a` is older, 1 when newer,
 * 0 when equal. Agent CLIs and their release sources report plain `X.Y.Z`;
 * anything else (a prerelease, a non-version) throws rather than being read as
 * "no update".
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}
