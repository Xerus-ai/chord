import { cloudFetch, resolveOrgId } from '@main/core/work-items/cloud-work-items-client';
import type { TeamPublishingPolicy } from './team-publishing-policy';

/**
 * The signed-in user's team policy. A publish that cannot read it does not
 * start: an unknown policy is never taken as allowed.
 */
export async function readTeamPublishingPolicy(): Promise<TeamPublishingPolicy> {
  const orgId = await resolveOrgId();
  if (!orgId) throw new Error("Sign in to Chord: publishing follows your team's policy");
  const res = await cloudFetch(`/organizations/${orgId}/sharing-policy`);
  if (!res.ok) {
    throw new Error(`Couldn't read your team's publishing policy (HTTP ${res.status})`);
  }
  return (await res.json()) as TeamPublishingPolicy;
}
