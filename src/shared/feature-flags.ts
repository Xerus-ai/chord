import type { FeatureFlags as WireFeatureFlags } from '@chord/protocol';

/**
 * What main tells the renderer (devstation-mg6u.90): every registered feature flag and whether
 * the sync server last turned it on. Off until the server says otherwise. The protocol's type,
 * named here so main and the renderer import app types from @shared; it cannot drift from it.
 */
export type FeatureFlags = WireFeatureFlags;
