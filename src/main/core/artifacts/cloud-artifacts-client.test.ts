import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a queued version upload puts on the wire (design 2026-09-24 §9–§10).
 * The queue row's payload is covered by the entry-point suites; this pins the
 * request body the sync server receives, on a real local HTTP server. The
 * signed-in account goes through the real account path (`_testing/test-account.ts`).
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { uploadCloudArtifactVersion } = await import('./cloud-artifacts-client');

interface CapturedRequest {
  method: string | undefined;
  url: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let captured: CapturedRequest[];
const originalApiUrl = process.env.CHORD_CLOUD_API_URL;

function startSyncServer(): Promise<string> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({
        method: req.method,
        url: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>,
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

const BASE = {
  artifact_id: 'a-upload',
  work_item_id: 'w-upload',
  client_version_id: 'v-upload',
  trigger: 'agent_milestone' as const,
  label: null,
};

describe('uploadCloudArtifactVersion', () => {
  beforeAll(async () => {
    await signInTestAccount({ username: 'uploader', email: 'uploader@example.com' });
    process.env.CHORD_CLOUD_API_URL = await startSyncServer();
  });

  beforeEach(() => {
    captured = [];
  });

  afterAll(async () => {
    if (originalApiUrl === undefined) delete process.env.CHORD_CLOUD_API_URL;
    else process.env.CHORD_CLOUD_API_URL = originalApiUrl;
    await new Promise((resolve) => server.close(resolve));
  });

  it("sends a pdf version's bytes and MIME type, and no view", async () => {
    const result = await uploadCloudArtifactVersion({
      ...BASE,
      file_base64: 'JVBERi0xLjQ=',
      mime_type: 'application/pdf',
    });

    expect(result).toEqual({ ok: true });
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('/work-items/w-upload/artifacts/a-upload/versions');
    expect(captured[0].body).toEqual({
      client_version_id: 'v-upload',
      trigger: 'agent_milestone',
      file_base64: 'JVBERi0xLjQ=',
      mime_type: 'application/pdf',
    });
  });

  it("sends a docx version's bytes and MIME type with its view", async () => {
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await uploadCloudArtifactVersion({
      ...BASE,
      file_base64: 'UEsDBA==',
      mime_type: mimeType,
      view_html: '<!doctype html><p>memo</p>',
    });

    expect(captured[0].body).toEqual({
      client_version_id: 'v-upload',
      trigger: 'agent_milestone',
      file_base64: 'UEsDBA==',
      mime_type: mimeType,
      view_html: '<!doctype html><p>memo</p>',
    });
  });

  it("sends a page version's source and view, and no file fields", async () => {
    await uploadCloudArtifactVersion({
      ...BASE,
      label: 'Launch',
      content: '<h1>page</h1>',
      view_html: '<!doctype html><h1>page</h1>',
    });

    expect(captured[0].body).toEqual({
      client_version_id: 'v-upload',
      trigger: 'agent_milestone',
      label: 'Launch',
      content: '<h1>page</h1>',
      view_html: '<!doctype html><h1>page</h1>',
    });
  });
});
