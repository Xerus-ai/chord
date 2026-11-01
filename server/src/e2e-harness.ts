import WebSocket from 'ws';

/**
 * Shared plumbing for the live two-token probes (e2e-test.ts and
 * e2e-chat-probe.ts) — the server package has no test harness by design;
 * these run against the live dev stack with two real user JWTs.
 */

export const API_BASE = process.env.API_BASE ?? 'http://localhost:1234';
export const WS_URL = process.env.WS_URL ?? 'ws://localhost:1234/ws';

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export const results: TestResult[] = [];

export async function apiFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

export function connectWs(token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.on('open', () => clearTimeout(timeout));
  });
}

export function waitForMessage(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  return waitForMessageWhere(ws, type, () => true, timeoutMs);
}

/** Waits for the first `type` frame whose payload satisfies the predicate. */
export function waitForMessageWhere(
  ws: WebSocket,
  type: string,
  predicate: (payload: unknown) => boolean,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for ${type}`));
    }, timeoutMs);

    const handler = (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString()) as { type: string; payload: unknown };
      if (msg.type === type && predicate(msg.payload)) {
        clearTimeout(timeout);
        ws.off('message', handler);
        resolve(msg as unknown as Record<string, unknown>);
      }
    };

    ws.on('message', handler);
  });
}

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    console.log(`  PASS  ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, duration: Date.now() - start, error });
    console.log(`  FAIL  ${name}: ${error}`);
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function printSummaryAndExit(): void {
  console.log('\n=== Results ===\n');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total\n`);

  if (failed > 0) {
    console.log('Failures:');
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }
}

export function requireTokens(): { userAToken: string; userBToken: string } {
  const userAToken = process.env.USER_A_TOKEN ?? '';
  const userBToken = process.env.USER_B_TOKEN ?? '';
  if (!userAToken || !userBToken) {
    console.error('Set USER_A_TOKEN and USER_B_TOKEN environment variables');
    console.error('These should be valid WorkOS JWTs for two different users');
    process.exit(1);
  }
  return { userAToken, userBToken };
}
