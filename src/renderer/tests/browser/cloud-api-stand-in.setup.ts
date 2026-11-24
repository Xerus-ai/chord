import { createServer, type Server } from 'node:http';

/**
 * A local stand-in for the sync server's REST API, for the browser project
 * (vitest globalSetup, run in Node). The browser project builds the renderer
 * with VITE_CLOUD_API_URL pointing here (vitest.config.ts), so no browser test
 * reaches a real server. It answers CORS preflights as the real server's cors
 * middleware does (the requesting origin and requested headers reflected), so
 * a header the real server would refuse to accept cross-origin fails here too.
 * GET /__seen lists each request it served, with the X-Chord-Version it carried.
 */
export const BROWSER_TEST_CLOUD_API_PORT = 63410;

type Seen = { method: string; path: string; version: string | null };

let server: Server | null = null;

export async function setup(): Promise<void> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      const requested = req.headers['access-control-request-headers'];
      if (requested) res.setHeader('Access-Control-Allow-Headers', requested);
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.url === '/__seen') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(seen));
      return;
    }
    const header = req.headers['x-chord-version'];
    seen.push({
      method: req.method ?? '',
      path: req.url ?? '',
      version: (Array.isArray(header) ? header[0] : header) ?? null,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end('{}');
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(BROWSER_TEST_CLOUD_API_PORT, '127.0.0.1', resolve);
  });
}

export async function teardown(): Promise<void> {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
}
