import { dateGroup } from './artifact-ui-utils';
import type { ArtifactVersion } from './use-versions';

/** Why a version exists: its label when it has one ("Restored v2"), else how it was made. */
export function describeVersionReason(version: ArtifactVersion): string {
  if (version.label) return version.label;
  if (version.trigger === 'manual') return 'Saved';
  if (version.trigger === 'agent_milestone') return 'Agent update';
  return 'Auto-saved';
}

export interface VersionDay {
  day: ReturnType<typeof dateGroup>;
  versions: ArtifactVersion[];
}

/** The history as the Versions card lists it: newest first, a heading at each new day. */
export function groupVersionsByDay(versions: ArtifactVersion[]): VersionDay[] {
  const groups: VersionDay[] = [];
  for (const version of versions) {
    const day = dateGroup(version.created_at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.versions.push(version);
    else groups.push({ day, versions: [version] });
  }
  return groups;
}
