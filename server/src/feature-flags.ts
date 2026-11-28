import {
  FEATURE_FLAGS,
  isFeatureFlag,
  resolveFeatureFlags,
  type FeatureFlags,
} from '@chord/protocol';

/**
 * The feature flags this server turns on (devstation-mg6u.90), from the optional
 * CHORD_FEATURE_FLAGS: a comma-separated list of registered flag names. Unset or empty turns
 * none on. A name that is not a registered flag throws, so a typo on the box stops the server
 * (and its deploy health check) instead of silently turning nothing on.
 */
export function enabledFeatureFlags(raw: string | undefined): FeatureFlags {
  const names = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const unknown = names.filter((name) => !isFeatureFlag(name));
  if (unknown.length > 0) {
    throw new Error(
      `CHORD_FEATURE_FLAGS names ${unknown.join(', ')}, not a registered flag (known: ${Object.keys(FEATURE_FLAGS).join(', ')})`
    );
  }
  return resolveFeatureFlags(Object.fromEntries(names.map((name) => [name, true])));
}
