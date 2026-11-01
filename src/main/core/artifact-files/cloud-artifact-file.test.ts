import { describe, expect, it } from 'vitest';
import { ArtifactFileMissingError, readCloudArtifactFile } from './cloud-artifact-file';

/**
 * The server's answer to `GET …/artifacts/:aid/file` (design 2026-09-24 §10
 * "Server"), read from real `Response` objects.
 */
describe('readCloudArtifactFile', () => {
  it('reads a file version', async () => {
    const body = {
      version_id: 'v2',
      version_number: 2,
      trigger: 'agent_milestone',
      author_name: 'ada@example.com',
      created_at: '2026-09-26T10:00:00.000Z',
      mime_type: 'application/pdf',
      byte_size: 4,
      file_base64: Buffer.from('%PDF').toString('base64'),
    };
    const file = await readCloudArtifactFile(Response.json(body));
    expect(file).toEqual({
      versionId: 'v2',
      versionNumber: 2,
      mimeType: 'application/pdf',
      byteSize: 4,
      bytes: Buffer.from('%PDF'),
    });
  });

  it('tells a missing file apart from a failure', async () => {
    await expect(
      readCloudArtifactFile(Response.json({ error: 'no_file' }, { status: 404 }))
    ).rejects.toThrow(ArtifactFileMissingError);
    await expect(
      readCloudArtifactFile(Response.json({ error: 'Not found' }, { status: 404 }))
    ).rejects.toThrow(/HTTP 404/);
  });

  it('refuses a MIME type the app has no viewer for', async () => {
    const body = {
      version_id: 'v1',
      version_number: 1,
      trigger: 'manual',
      author_name: null,
      created_at: '2026-09-26T10:00:00.000Z',
      mime_type: 'text/html',
      byte_size: 1,
      file_base64: 'eA==',
    };
    await expect(readCloudArtifactFile(Response.json(body))).rejects.toThrow();
  });
});
