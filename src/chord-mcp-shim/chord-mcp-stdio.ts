import { createInterface } from 'node:readline';

/**
 * The `chord` MCP server for agents that only launch stdio servers (plan
 * 2026-09-23 P3). It holds no tools of its own: every JSON-RPC line from the
 * agent is POSTed to Chord's loopback endpoint with the session's bearer
 * token, and the endpoint's reply is written back as a line. Chord runs it
 * with its own executable in Node mode (`ELECTRON_RUN_AS_NODE=1`), so an
 * agent needs no Node install to reach Chord.
 *
 * Environment (set by Chord when it hands the agent this server):
 *   CHORD_MCP_URL    the loopback endpoint, `http://127.0.0.1:<port>/mcp`
 *   CHORD_MCP_TOKEN  the session's bearer token
 *
 * A request Chord cannot answer — the app closed, the session ended — gets a
 * JSON-RPC error reply with the reason, so the agent sees why instead of
 * waiting on a request that never completes. Standard output carries only
 * protocol messages; diagnostics go to standard error.
 */

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  result?: { protocolVersion?: string };
}

const endpoint = process.env.CHORD_MCP_URL;
const token = process.env.CHORD_MCP_TOKEN;
if (!endpoint || !token) {
  process.stderr.write('chord-mcp: CHORD_MCP_URL and CHORD_MCP_TOKEN must be set\n');
  process.exit(1);
}

/** Negotiated in `initialize`; later requests name it, as MCP over HTTP requires. */
let protocolVersion: string | null = null;

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function replyWithError(id: JsonRpcMessage['id'], reason: string): void {
  process.stderr.write(`chord-mcp: ${reason}\n`);
  // Notifications (no id) have no reply to carry the error.
  if (id === undefined || id === null) return;
  write({ jsonrpc: '2.0', id, error: { code: -32603, message: reason } });
}

async function forward(line: string): Promise<void> {
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;

  let response: Response;
  try {
    response = await fetch(endpoint!, { method: 'POST', headers, body: line });
  } catch (error) {
    replyWithError(message.id, `Chord is not reachable: ${(error as Error).message}`);
    return;
  }
  if (response.status === 202) return;
  const body = await response.text();
  if (!response.ok) {
    replyWithError(
      message.id,
      `Chord refused the request (${response.status}): ${body.slice(0, 500)}`
    );
    return;
  }

  const parsed = JSON.parse(body) as JsonRpcMessage | JsonRpcMessage[];
  for (const reply of Array.isArray(parsed) ? parsed : [parsed]) {
    if (message.method === 'initialize' && reply.result?.protocolVersion) {
      protocolVersion = reply.result.protocolVersion;
    }
    write(reply);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  if (line.trim() === '') return;
  forward(line).catch((error: unknown) => {
    process.stderr.write(`chord-mcp: ${(error as Error).stack ?? String(error)}\n`);
  });
});
lines.on('close', () => process.exit(0));
