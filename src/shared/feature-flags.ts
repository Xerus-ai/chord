import type { FeatureFlag } from '@chord/protocol';

/**
 * What main tells the renderer (devstation-mg6u.90): every registered feature flag and whether
 * the sync server last turned it on. Off until the server says otherwise.
 */
export type FeatureFlags = Record<FeatureFlag, boolean>;
