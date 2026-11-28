import { z } from 'zod';

/**
 * Feature flags (devstation-mg6u.90): unfinished user-visible work merges to main behind a flag,
 * and the sync server's /health names which flags are on. A feature epic's first story adds its
 * flag here; its last story removes the flag and every check of it. A flag the server does not
 * turn on is off, so an app offline since its install, or on a server that predates a flag,
 * never shows unfinished work. Before the release that removes a flag deploys, take its name out
 * of the server's CHORD_FEATURE_FLAGS: a name not in the registry stops the server at boot
 * (server/DEPLOYMENT.md).
 */
export const FEATURE_FLAGS = {
  whats_new: {
    title: "What's new",
    added: '2026-11-26',
    bead: 'devstation-haay',
  },
} as const satisfies Record<string, { title: string; added: string; bead: string }>;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;
export type FeatureFlags = Record<FeatureFlag, boolean>;

/** The `flags` of /health: name -> on. Names the reader does not know are ignored. */
export const FeatureFlagsSchema = z.record(z.string(), z.boolean());

export function isFeatureFlag(name: string): name is FeatureFlag {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, name);
}

/** Every registered flag, on only where `served` says true; missing and unknown names are off. */
export function resolveFeatureFlags(served: Record<string, boolean> | undefined): FeatureFlags {
  const flags = {} as FeatureFlags;
  for (const name of Object.keys(FEATURE_FLAGS) as FeatureFlag[]) {
    flags[name] = served?.[name] === true;
  }
  return flags;
}
