import z from 'zod';
import { cloudFetch } from '@main/core/work-items/cloud-work-items-client';

/**
 * A page version's view as the cloud holds it (design 2026-09-24 §9 "Server
 * API": `GET /work-items/:wid/artifacts/:aid/view[?version_id=]`).
 */
export interface CloudArtifactView {
  versionId: string;
  versionNumber: number;
  trigger: string;
  authorName: string | null;
  createdAt: string;
  html: string;
}

/** The server holds no view for this artifact (or version) — `404 { error: 'no_view' }`. */
export class ArtifactViewMissingError extends Error {
  constructor() {
    super('This page has no shared view yet. Its author has to publish or save it first.');
    this.name = 'ArtifactViewMissingError';
  }
}

const viewBodySchema = z.object({
  version_id: z.string(),
  version_number: z.number().int(),
  trigger: z.string(),
  author_name: z.string().nullable(),
  created_at: z.string(),
  html: z.string(),
});

function isNoViewBody(text: string): boolean {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON, so not the server's no_view answer: an ordinary failure.
    return false;
  }
  return (body as { error?: unknown } | null)?.error === 'no_view';
}

export async function readCloudArtifactView(response: Response): Promise<CloudArtifactView> {
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 && isNoViewBody(text)) throw new ArtifactViewMissingError();
    throw new Error(
      `Fetching the page view failed: HTTP ${response.status}: ${text.slice(0, 300)}`
    );
  }
  const body = viewBodySchema.parse(await response.json());
  return {
    versionId: body.version_id,
    versionNumber: body.version_number,
    trigger: body.trigger,
    authorName: body.author_name,
    createdAt: body.created_at,
    html: body.html,
  };
}

export async function fetchCloudArtifactView(args: {
  workItemId: string;
  artifactId: string;
  versionId?: string;
}): Promise<CloudArtifactView> {
  const query = args.versionId ? `?version_id=${encodeURIComponent(args.versionId)}` : '';
  const response = await cloudFetch(
    `/work-items/${encodeURIComponent(args.workItemId)}/artifacts/${encodeURIComponent(args.artifactId)}/view${query}`
  );
  return readCloudArtifactView(response);
}
