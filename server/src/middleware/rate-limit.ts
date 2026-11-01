import type { Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { AuthenticatedRequest } from './auth.js';

// A userId key and a raw req.ip key can never collide in practice (userIds
// aren't formatted like IPs), but ipKeyGenerator's subnet normalization
// (below) is required by express-rate-limit for any key derived from an IP
// at all — an ungrouped IPv6 address lets a client bypass an IP-keyed limit
// just by rotating through the many addresses available in its own /64
// subnet, so the library validates against exactly that at startup.
function userOrIpKey(req: Request): string {
  const userId = (req as AuthenticatedRequest).user?.userId;
  if (userId) return userId;
  return ipKeyGenerator(req.ip ?? 'unknown');
}

// ─── REST ────────────────────────────────────────────────────────────────
//
// Nothing on the REST surface was throttled before this: any authenticated
// user (or, on the pre-auth endpoints below, any caller at all) could send
// requests as fast as the driver/network allowed, hammering the Neon
// connection or flooding room broadcasts.
//
// Proxy note: IP-keyed limits below use Express's `req.ip`. Behind a reverse
// proxy that is the proxy's address unless TRUST_PROXY names the hop count
// (server.ts sets `trust proxy` from it; DEPLOYMENT.md documents one proxy).
// Without it every caller behind the proxy shares one IP-keyed bucket;
// trusting X-Forwarded-For from more hops than really exist would let a
// client spoof its IP and defeat IP-keying.

// express-rate-limit populates req.rateLimit at runtime but doesn't ship an
// Express.Request ambient augmentation reliably picked up by this project's
// module resolution — asserting the shape here (rather than fighting that)
// matches this file's existing `req as AuthenticatedRequest` pattern.
interface RequestWithRateLimit extends Request {
  rateLimit?: { resetTime?: Date };
}

/**
 * Sets Retry-After explicitly rather than relying on a specific
 * express-rate-limit version's default header behavior — checked the
 * installed version and it does not set this header on its own.
 */
function sendTooManyRequests(req: Request, res: Response): void {
  const resetTime = (req as RequestWithRateLimit).rateLimit?.resetTime;
  if (resetTime instanceof Date) {
    const retryAfterSeconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
  }
  res.status(429).json({ error: 'Too many requests' });
}

/**
 * General authenticated-route ceiling — a safety net against a single
 * account's runaway client bug or deliberate flood, not a per-feature
 * throttle (git-state's own MIN_PUSH_INTERVAL_MS, sync-queue's backoff, etc.
 * already shape normal traffic well under this). Keyed by authenticated user
 * id, not IP: the Electron client is the only real caller, and users
 * legitimately run it from shared office/VPN IPs (under-throttles if keyed
 * by IP) while a single user's multiple windows/devices can just as
 * legitimately span several IPs (over-throttles if keyed by IP). Mount AFTER
 * requireAuth — req.user must already be populated for the key to mean
 * anything.
 */
export const userRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: sendTooManyRequests,
});

/**
 * GET /auth/callback — hit once (occasionally twice, on a browser refresh)
 * per sign-in, when WorkOS redirects the system browser back with a code.
 * Never polled, so a tight per-IP budget is safe and meaningfully closes off
 * this as a brute-forceable surface (guessing `state`/`code` values).
 */
export const authCallbackRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: sendTooManyRequests,
});

/**
 * GET /auth/poll — NOT hit once: src/main/core/account/services/
 * workos-auth-service.ts polls this every 1500ms for up to authTimeoutMs (5
 * minutes by default, src/main/core/account/config.ts) while the sign-in
 * completes, i.e. ~40 requests/minute sustained for the ENTIRE window, not a
 * one-off burst. A 30/min budget (this endpoint's naive "auth endpoint"
 * default) would routinely rate-limit real sign-ins partway through; 60/min
 * leaves headroom for that steady-state rate plus jitter/retries plus a
 * second concurrent sign-in sharing the same IP, while still capping what
 * was previously unlimited (e.g. brute-forcing the `state` query param to
 * steal another user's in-flight OAuth code).
 */
export const authPollRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: sendTooManyRequests,
});

/**
 * POST /auth/sync-profile — authenticated (mounted after requireAuth), so
 * keyed by userId like userRateLimiter, not IP. Stricter than the general
 * 300/min ceiling because a cache-miss path here calls out to the WorkOS API
 * to create an organization (server.ts's sync-profile handler) — an
 * external, cost-bearing call that a flood would amplify. Called at most a
 * few times per session in normal use (once at sign-in, occasionally via
 * resolveOrgId's lazy org resolution), so 30/min/user is generous for any
 * real client while still bounding the WorkOS-call amplification.
 */
export const syncProfileRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  handler: sendTooManyRequests,
});

// ─── WebSocket per-connection budget ────────────────────────────────────
//
// The WS message loop (server.ts's `ws.on('message', ...)`) had no per-
// connection budget at all: one authenticated socket could send messages as
// fast as the transport allowed, each one potentially triggering a DB query
// and a room broadcast fanned out to every other connected member.

const WS_WINDOW_MS = 1_000;
// Presence/cursor and typing-indicator traffic is the chattiest event type
// here, but still small JSON control frames — chat/artifact/work-item
// mutations and bulk content go over REST (server.ts's raised
// express.json() limits), never WS. 60 messages/window and 1MB/window are
// comfortably above any legitimate per-second rate this app produces, while
// still bounding a socket that's actually flooding.
const WS_MAX_MESSAGES_PER_WINDOW = 60;
const WS_MAX_BYTES_PER_WINDOW = 1024 * 1024;
// "Sustained abuse", not a single blip: one window over budget (a momentary
// spike, a reconnect storm) is tolerated and simply processed — only a
// caller whose window is STILL over budget for this many consecutive
// windows in a row gets disconnected.
const WS_MAX_CONSECUTIVE_OVER_BUDGET_WINDOWS = 3;

export type WsRateLimitResult = 'ok' | 'terminate';

export interface WsRateLimiter {
  /** Call once per inbound message with its raw byte length. */
  consume(byteLength: number): WsRateLimitResult;
}

/**
 * Fixed-window counter, not a token bucket: "N consecutive windows over
 * budget" is the sustained-abuse signal the caller (server.ts) acts on, and
 * a fixed window makes that a direct comparison of per-window counts rather
 * than reconstructing window boundaries out of continuously-refilling
 * tokens. Takes an injectable clock (defaults to Date.now) so this is
 * unit-testable without real timers — no test runner exists yet in
 * server/ to wire up, so no test file is added here, but the class doesn't
 * need one added to be tested later.
 *
 * One of these is created per WebSocket connection (server.ts's
 * `wss.on('connection', ...)`) and closed over by that connection's
 * `message` handler — never shared across connections, so one abusive
 * socket's budget can't starve another's.
 */
export function createWsRateLimiter(now: () => number = Date.now): WsRateLimiter {
  let windowStart = now();
  let windowMessages = 0;
  let windowBytes = 0;
  let consecutiveOverBudgetWindows = 0;

  function rollWindowIfElapsed(): void {
    const current = now();
    if (current - windowStart < WS_WINDOW_MS) return;

    const windowWasOverBudget =
      windowMessages > WS_MAX_MESSAGES_PER_WINDOW || windowBytes > WS_MAX_BYTES_PER_WINDOW;
    consecutiveOverBudgetWindows = windowWasOverBudget ? consecutiveOverBudgetWindows + 1 : 0;

    windowStart = current;
    windowMessages = 0;
    windowBytes = 0;
  }

  return {
    consume(byteLength: number): WsRateLimitResult {
      rollWindowIfElapsed();
      windowMessages += 1;
      windowBytes += byteLength;

      return consecutiveOverBudgetWindows >= WS_MAX_CONSECUTIVE_OVER_BUDGET_WINDOWS
        ? 'terminate'
        : 'ok';
    },
  };
}
