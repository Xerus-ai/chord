import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import type { ArtifactRow } from '@main/db/schema-artifacts';
import type { ArtifactStatus } from './artifact-utils';
import type { CloudArtifactCreatePayload } from './cloud-artifacts-client';

const STATUSES: ReadonlySet<string> = new Set<ArtifactStatus>([
  'draft',
  'in_review',
  'approved',
  'built',
]);

/**
 * What registering a local artifact sends the cloud: its work item, name,
 * types, and the owner's status (devstation-664). One builder for every
 * register: the first, the startup backfill, and each status change, which
 * re-registers (the cloud's register is an idempotent upsert).
 */
export function artifactRegisterPayload(row: ArtifactRow): CloudArtifactCreatePayload {
  if (!STATUSES.has(row.status)) {
    throw new Error(`Artifact ${row.id} has a status the cloud does not take: "${row.status}"`);
  }
  return {
    work_item_id: row.workItemId,
    name: row.name,
    content_type: row.contentType,
    render_class: renderClassForArtifactType(row.type as ArtifactType),
    status: row.status as ArtifactStatus,
  };
}
