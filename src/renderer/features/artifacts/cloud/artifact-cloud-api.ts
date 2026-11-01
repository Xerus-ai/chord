import type { PublicLinkResolution } from '@chord/protocol';
import type { ArtifactVersion } from '@renderer/lib/cloud-api';
import { cloudFetch } from '@renderer/lib/cloud-fetch';
import { buildSaveVersionBody, type SaveVersionRequest } from '@renderer/lib/cloud-version-request';
import type { CloudArtifactSummaryRow } from '../artifact-rail-summary';
import { parseCloudArtifactDetail, type CloudArtifactDetail } from './cloud-artifact';

/**
 * Artifacts addressed on their own (P6) and public links opened in the app.
 * Server: `server/src/routes/artifacts.ts`, `server/src/web/public-link-routes.ts`,
 * `server/src/routes/public-link-comments.ts`.
 */
export interface VersionSnapshot {
  html: string;
  byte_size: number;
}

export interface ArtifactComment {
  id: string;
  artifact_id: string;
  parent_comment_id: string | null;
  author_id: string;
  author_name: string;
  anchor_key: string | null;
  anchor_text: string | null;
  body: string;
  resolved: boolean;
  resolved_by: string | null;
  created_at: string;
}

export interface AddToChatResult {
  markdown: string;
  count: number;
}

export const artifactCloudApi = {
  getComments: (workItemId: string, artifactId: string) =>
    cloudFetch<ArtifactComment[]>(`/work-items/${workItemId}/artifacts/${artifactId}/comments`),

  createComment: (
    workItemId: string,
    artifactId: string,
    data: {
      body: string;
      parent_comment_id?: string | null;
      anchor_key?: string | null;
      anchor_text?: string | null;
    }
  ) =>
    cloudFetch<ArtifactComment>(`/work-items/${workItemId}/artifacts/${artifactId}/comments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  resolveComment: (workItemId: string, artifactId: string, commentId: string) =>
    cloudFetch<ArtifactComment>(
      `/work-items/${workItemId}/artifacts/${artifactId}/comments/${commentId}/resolve`,
      { method: 'POST' }
    ),

  unresolveComment: (workItemId: string, artifactId: string, commentId: string) =>
    cloudFetch<ArtifactComment>(
      `/work-items/${workItemId}/artifacts/${artifactId}/comments/${commentId}/unresolve`,
      { method: 'POST' }
    ),

  addCommentsToChat: (workItemId: string, artifactId: string) =>
    cloudFetch<AddToChatResult>(
      `/work-items/${workItemId}/artifacts/${artifactId}/comments/add-to-chat`,
      { method: 'POST' }
    ),

  getVersions: (workItemId: string, artifactId: string) =>
    cloudFetch<ArtifactVersion[]>(`/work-items/${workItemId}/artifacts/${artifactId}/versions`),

  getVersionSnapshot: (workItemId: string, artifactId: string, versionId: string) =>
    cloudFetch<VersionSnapshot>(
      `/work-items/${workItemId}/artifacts/${artifactId}/versions/${versionId}/snapshot`
    ),

  /**
   * Saves a document version from the server's live Yjs state. A manual save
   * names its base version (a stale base is a 409 `conflict`); an agent
   * milestone carries none (see `buildSaveVersionBody`).
   */
  saveVersion: (workItemId: string, artifactId: string, request: SaveVersionRequest) =>
    cloudFetch<{ status: string }>(`/work-items/${workItemId}/artifacts/${artifactId}/versions`, {
      method: 'POST',
      body: JSON.stringify(buildSaveVersionBody(request)),
    }),

  getArtifactDetail: async (artifactId: string): Promise<CloudArtifactDetail> =>
    parseCloudArtifactDetail(await cloudFetch<unknown>(`/artifacts/${artifactId}`)),

  /** A public link, for a signed-in caller who reaches its artifact; 404 otherwise. */
  resolvePublicLink: (token: string) =>
    cloudFetch<PublicLinkResolution>(`/public-links/${encodeURIComponent(token)}/resolve`),

  /** Per artifact of the work item: open threads, the caller's unread, the latest version (S8). */
  getArtifactSummary: (workItemId: string) =>
    cloudFetch<CloudArtifactSummaryRow[]>(`/work-items/${workItemId}/artifact-summary`),

  /** The caller has read this artifact's comments up to now. */
  markCommentsRead: (workItemId: string, artifactId: string) =>
    cloudFetch<void>(`/work-items/${workItemId}/artifacts/${artifactId}/comments/read`, {
      method: 'PUT',
    }),
};
