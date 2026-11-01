import type { ArtifactRenderClass } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import type { ArtifactVersion as CloudArtifactVersion } from '@renderer/lib/cloud-api';
import type { ArtifactAccessRole } from '../artifact-surface';
import type { ArtifactVersion } from '../use-versions';

/** `GET /artifacts/:id` (server/src/routes/artifacts.ts), narrowed to what the app decides on. */
export interface CloudArtifactDetail {
  id: string;
  work_item_id: string;
  work_item_name: string;
  name: string;
  content_type: ArtifactType;
  render_class: ArtifactRenderClass;
  caller_role: ArtifactAccessRole;
  /** The role inherited from the work item; null = the artifact alone was shared. */
  work_item_role: ArtifactAccessRole | null;
  updated_at: string;
}

const RENDER_CLASSES: readonly ArtifactRenderClass[] = ['document', 'page', 'file'];
const ROLES: readonly ArtifactAccessRole[] = ['view', 'edit', 'author'];
const ARTIFACT_TYPES: readonly ArtifactType[] = [
  'markdown',
  'mdx',
  'text',
  'image',
  'document',
  'web',
  'prototype',
];

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string') {
    throw new Error(`[artifacts] GET /artifacts/:id returned no ${key} (got ${String(value)})`);
  }
  return value;
}

function readMember<T extends string>(
  body: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T {
  const value = readString(body, key);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`[artifacts] GET /artifacts/:id returned an unknown ${key}: ${value}`);
  }
  return value as T;
}

/**
 * Validates a `GET /artifacts/:id` body. An unknown render class or role is a
 * contract break with the server, thrown rather than guessed at — guessing an
 * access level is how a read-only viewer ends up with an editable document.
 */
export function parseCloudArtifactDetail(raw: unknown): CloudArtifactDetail {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('[artifacts] GET /artifacts/:id returned no artifact object');
  }
  const body = raw as Record<string, unknown>;
  return {
    id: readString(body, 'id'),
    work_item_id: readString(body, 'work_item_id'),
    work_item_name: readString(body, 'work_item_name'),
    name: readString(body, 'name'),
    content_type: readMember(body, 'content_type', ARTIFACT_TYPES),
    render_class: readMember(body, 'render_class', RENDER_CLASSES),
    caller_role: readMember(body, 'caller_role', ROLES),
    work_item_role: body.work_item_role === null ? null : readMember(body, 'work_item_role', ROLES),
    updated_at: readString(body, 'updated_at'),
  };
}

/** A server version row in the history panel's shape. Cloud rows carry no content. */
export function toArtifactVersionFromCloud(row: CloudArtifactVersion): ArtifactVersion {
  return {
    id: row.id,
    label: row.label,
    trigger: row.trigger,
    author_name: row.author_name,
    created_at: row.created_at,
    version_number: row.version_number,
    byte_size: row.byte_size,
  };
}
