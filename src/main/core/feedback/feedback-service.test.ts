import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { submitFeedback } from './feedback-service';

interface CapturedRequest {
  contentType: string | undefined;
  body: Buffer;
}

let server: Server;
let captured: CapturedRequest[];
let responseStatus: number;
const originalWebhookUrl = process.env.CHORD_FEEDBACK_WEBHOOK_URL;

function startWebhookServer(): Promise<string> {
  captured = [];
  responseStatus = 204;
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      captured.push({ contentType: req.headers['content-type'], body: Buffer.concat(chunks) });
      res.writeHead(responseStatus);
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}/webhook`);
    });
  });
}

describe('submitFeedback', () => {
  beforeEach(async () => {
    process.env.CHORD_FEEDBACK_WEBHOOK_URL = await startWebhookServer();
  });

  afterEach(async () => {
    if (originalWebhookUrl === undefined) delete process.env.CHORD_FEEDBACK_WEBHOOK_URL;
    else process.env.CHORD_FEEDBACK_WEBHOOK_URL = originalWebhookUrl;
    await new Promise((resolve) => server.close(resolve));
  });

  it('fails with not_configured when the webhook env var is unset', async () => {
    delete process.env.CHORD_FEEDBACK_WEBHOOK_URL;

    const result = await submitFeedback({ content: 'Great app', attachments: [] });

    expect(result).toEqual({ success: false, error: { type: 'not_configured' } });
    expect(captured).toHaveLength(0);
  });

  it('fails with empty_content and sends nothing when the content is blank', async () => {
    const result = await submitFeedback({ content: '   ', attachments: [] });

    expect(result).toEqual({ success: false, error: { type: 'empty_content' } });
    expect(captured).toHaveLength(0);
  });

  it('posts JSON content when there are no attachments', async () => {
    const result = await submitFeedback({ content: 'Great app', attachments: [] });

    expect(result.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].contentType).toBe('application/json');
    expect(JSON.parse(captured[0].body.toString('utf8'))).toEqual({ content: 'Great app' });
  });

  it('posts multipart form data carrying the attachment bytes', async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71]);

    const result = await submitFeedback({
      content: 'Screenshot attached',
      attachments: [
        { fileName: 'shot.png', mimeType: 'image/png', data: bytes.buffer as ArrayBuffer },
      ],
    });

    expect(result.success).toBe(true);
    expect(captured[0].contentType).toContain('multipart/form-data');
    const body = captured[0].body.toString('binary');
    expect(body).toContain('name="content"');
    expect(body).toContain('Screenshot attached');
    expect(body).toContain('name="file0"; filename="shot.png"');
    expect(body).toContain(Buffer.from(bytes).toString('binary'));
  });

  it('fails with webhook_failed when the webhook rejects the request', async () => {
    responseStatus = 401;

    const result = await submitFeedback({ content: 'Great app', attachments: [] });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error.type).toBe('webhook_failed');
  });
});
