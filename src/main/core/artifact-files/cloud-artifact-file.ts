import z from 'zod';
import { ARTIFACT_FILE_MIME_TYPES, type ArtifactFileMimeType } from '@shared/artifact-file-types';

/**
 * A file version's bytes as the cloud holds them — the response parser only;
 * prepare-cloud-artifact-file.ts fetches (design 2026-09-24 §10
 * "Server": `GET /work-items/:wid/artifacts/:aid/file[?version_id=]`).
 */
export interface CloudArtifactFile {
  versionId: string;
  versionNumber: number;
  mimeType: ArtifactFileMimeType;
  byteSize: number;
  bytes: Buffer;
}

/** The server holds no bytes for this file (or version) — `404 { error: 'no_file' }`. */
export class ArtifactFileMissingError extends Error {
  constructor() {
    super('This file has no shared copy yet. Its author has to publish it first.');
    this.name = 'ArtifactFileMissingError';
  }
}

const fileBodySchema = z.object({
  version_id: z.string(),
  version_number: z.number().int(),
  mime_type: z.enum(ARTIFACT_FILE_MIME_TYPES),
  byte_size: z.number().int().nonnegative(),
  file_base64: z.string(),
});

function isNoFileBody(text: string): boolean {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON, so not the server's no_file answer: an ordinary failure.
    return false;
  }
  return (body as { error?: unknown } | null)?.error === 'no_file';
}

export async function readCloudArtifactFile(response: Response): Promise<CloudArtifactFile> {
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 404 && isNoFileBody(text)) throw new ArtifactFileMissingError();
    throw new Error(`Fetching the file failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const body = fileBodySchema.parse(await response.json());
  const bytes = Buffer.from(body.file_base64, 'base64');
  if (bytes.byteLength !== body.byte_size) {
    throw new Error(
      `The file arrived as ${bytes.byteLength} bytes; the server said ${body.byte_size}`
    );
  }
  return {
    versionId: body.version_id,
    versionNumber: body.version_number,
    mimeType: body.mime_type,
    byteSize: body.byte_size,
    bytes,
  };
}
