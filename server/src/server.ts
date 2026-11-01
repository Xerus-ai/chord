import { createServer } from 'node:http';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { handlePolarWebhook } from './billing/polar-webhook.js';
import { DEV_MODE, requireAuth, type AuthenticatedRequest } from './middleware/auth.js';
import { mountJsonBodyParsers } from './middleware/json-body-parsers.js';
import {
  authCallbackRateLimiter,
  authPollRateLimiter,
  userRateLimiter,
} from './middleware/rate-limit.js';
import { startNotificationRetention } from './notifications/delete-expired-notifications.js';
import { createBillingRouter } from './routes/billing.js';
import { startCommandExpirySweep } from './routes/commands-device.js';
import { mountResourceRoutes } from './routes/mount-resource-routes.js';
import { registerSyncProfileRoute } from './routes/sync-profile.js';
import { teamPulseRouter } from './routes/team-pulse.js';
import { mountPublicWebRoutes } from './web/mount-public-web-routes.js';
import { ConnectionManager } from './ws/connection-manager.js';
import { createWebSocketServer } from './ws/create-websocket-server.js';

// The Electron app is the only real client: packaged builds load the
// renderer from the custom `app://` scheme (see src/main/app/protocol.ts,
// APP_SCHEME/APP_NAME_LOWER), and local dev loads it from the electron-vite
// dev server (electron.vite.config.ts renderer.server.port). Both are fixed,
// known origins, so they're safe defaults regardless of server NODE_ENV.
// ALLOWED_ORIGINS lets a deploy add more (e.g. a staging renderer) without
// a code change.
const DEFAULT_ALLOWED_ORIGINS = ['app://chord', 'app://chord-canary', 'http://localhost:3001'];
const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

// Outside production, accept ANY loopback origin regardless of port. The
// default list pins the renderer to :3001, but a dev machine can legitimately
// serve it elsewhere — electron-vite falling back to another port, a second
// stack, or 127.0.0.1 instead of localhost (a distinct CORS origin). Rejecting
// those surfaces in the renderer as an opaque "Failed to fetch" while WS keeps
// working, which is exactly the confusing state this guards against. Production
// (NODE_ENV=production) stays locked to the explicit allow-list above.
const isProduction = process.env.NODE_ENV === 'production';
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

// Off by default (Express's own default — req.ip is the raw socket address,
// unaffected by any X-Forwarded-* header). A deploy behind a reverse proxy
// (see DEPLOYMENT.md — the documented topology terminates TLS in front of
// this process) needs it on, or every caller's req.ip resolves to the
// proxy's own address: userRateLimiter's IP fallback and the pre-auth
// authCallbackRateLimiter/authPollRateLimiter (middleware/rate-limit.ts)
// would then see every distinct caller as ONE shared bucket, so concurrent
// legitimate sign-ins would starve each other under the same tight budget
// meant for one caller. TRUST_PROXY is a positive integer hop count (the
// number of reverse proxies between the client and this process — 1 for the
// single-proxy topology DEPLOYMENT.md documents) or the literal string
// 'true' to trust the nearest hop unconditionally. Fails fast on anything
// else: silently ignoring an unparseable value would leave IP-keying
// silently broken in exactly the situation this variable exists to fix.
const trustProxyEnv = process.env.TRUST_PROXY;
if (trustProxyEnv !== undefined && trustProxyEnv !== 'true' && !/^[1-9]\d*$/.test(trustProxyEnv)) {
  throw new Error(
    `TRUST_PROXY must be a positive integer hop count or 'true', got: '${trustProxyEnv}'`
  );
}

export function createApp(connectionManager: ConnectionManager) {
  const app = express();

  if (trustProxyEnv !== undefined) {
    app.set('trust proxy', trustProxyEnv === 'true' ? true : Number(trustProxyEnv));
  }

  // Polar webhooks are HMAC-verified over the RAW request body, so this route
  // must register before the JSON parsers (which would consume and
  // re-serialize the body, breaking the signature) — and it stays above
  // requireAuth below: Polar authenticates with its signature, not a JWT.
  app.post(
    '/billing/webhooks/polar',
    express.raw({ type: 'application/json' }),
    handlePolarWebhook
  );
  mountJsonBodyParsers(app);
  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header means the caller isn't a browser context (Electron
        // main-process fetch, server-to-server, curl) — nothing to reflect
        // credentials against, so it's safe to allow.
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        if (!isProduction && LOOPBACK_ORIGIN.test(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed: ${origin}`));
      },
      credentials: true,
    })
  );

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
    });
  });

  const pendingAuthCodes = new Map<string, string>();

  app.get('/auth/callback', authCallbackRateLimiter, (req, res) => {
    const code = req.query.code as string;
    const state = req.query.state as string;
    if (!code) {
      res.status(400).send('Missing authorization code');
      return;
    }
    if (state) {
      pendingAuthCodes.set(state, code);
      setTimeout(() => pendingAuthCodes.delete(state), 300_000);
    }
    res.send(`
      <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f9fafb">
        <div style="text-align:center">
          <h2 style="color:#0d9488">Signed in to Chord</h2>
          <p style="color:#6b7280">You can close this tab and return to the app.</p>
        </div>
      </body></html>
    `);
  });

  app.get('/auth/poll', authPollRateLimiter, (req, res) => {
    const state = req.query.state as string;
    if (!state) {
      res.status(400).json({ error: 'Missing state' });
      return;
    }
    const code = pendingAuthCodes.get(state);
    if (code) {
      pendingAuthCodes.delete(state);
      res.json({ code });
    } else {
      res.json({ code: null });
    }
  });

  // Signed-out web surface (P6): public artifact links and desktop handoff pages.
  mountPublicWebRoutes(app);

  app.use(requireAuth);
  app.use(userRateLimiter);

  app.get('/me', (req, res) => {
    const { user } = req as AuthenticatedRequest;
    res.json(user);
  });

  registerSyncProfileRoute(app, connectionManager);

  mountResourceRoutes(app, connectionManager);
  app.use('/billing', createBillingRouter());
  app.use('/team-pulse', teamPulseRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[chord-sync] unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}

export function startServer(port: number) {
  const connectionManager = new ConnectionManager();
  const app = createApp(connectionManager);
  const server = createServer(app);
  const wss = createWebSocketServer(server, connectionManager);

  connectionManager.start();
  startCommandExpirySweep(connectionManager);
  startNotificationRetention();

  server.listen(port, () => {
    console.log(`[chord-sync] listening on port ${port}`);
    console.log(`[chord-sync] health: http://localhost:${port}/health`);
    console.log(`[chord-sync] websocket: ws://localhost:${port}/ws`);
    if (DEV_MODE) {
      console.log(`[chord-sync] DEV MODE — auth bypassed, no database required`);
    }
  });

  return { app, server, wss, connectionManager };
}
