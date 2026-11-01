import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import packageJson from '@root/package.json';
import { log } from '@main/lib/logger';
import { resolveArtifactToolSession } from './artifact-tool-sessions';
import { buildChordTools } from './chord-mcp-server';
import { CHORD_MCP_SERVER_NAME } from './chord-server-name';

const MCP_PATH = '/mcp';

/**
 * The `chord` MCP server over loopback HTTP (plan 2026-09-23 P3), for agents
 * that are separate processes: ACP agents, Codex, and CLIs in a terminal. The
 * Claude chat transport keeps its in-process server; both serve the same tool
 * definitions (`buildChordTools`).
 *
 * - Bound to 127.0.0.1 on a port the OS picks; nothing off the machine sees it.
 * - Every request carries a per-session bearer token. The token is the only
 *   thing that names the work item, so an unknown or ended session is 401 and
 *   no tool runs. DNS-rebinding protection pins the Host header as well.
 * - Stateless: each POST gets its own server and transport, answered with a
 *   plain JSON body. The stdio shim relies on that — it forwards one line,
 *   reads one reply.
 */
let endpoint: Promise<{ url: string }> | null = null;

function bearerTokenOf(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  return match ? match[1] : null;
}

function replyWithJsonRpcError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message } }));
}

async function serveMcpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  host: string
): Promise<void> {
  if (new URL(request.url ?? '/', 'http://localhost').pathname !== MCP_PATH) {
    replyWithJsonRpcError(response, 404, 'Not found');
    return;
  }
  const token = bearerTokenOf(request);
  let session;
  try {
    if (!token) throw new Error('Missing bearer token.');
    session = resolveArtifactToolSession(token);
  } catch (error) {
    replyWithJsonRpcError(response, 401, (error as Error).message);
    return;
  }

  // Loaded on first request so the MCP SDK stays out of the startup module graph.
  const [{ McpServer }, { StreamableHTTPServerTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/server/mcp.js'),
    import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
  ]);
  const server = new McpServer({ name: CHORD_MCP_SERVER_NAME, version: packageJson.version });
  for (const tool of buildChordTools(token!, session.preferredFormat)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      // Validated against `inputSchema` by the SDK before the handler runs.
      (args: unknown, extra: unknown) => tool.handler(args as never, extra)
    );
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [host],
  });
  response.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response);
}

function listen(server: Server): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address() as AddressInfo);
    });
  });
}

async function startEndpoint(): Promise<{ url: string }> {
  let host = '';
  const server = createServer((request, response) => {
    serveMcpRequest(request, response, host).catch((error: unknown) => {
      log.error('chord-mcp endpoint: request failed', { error: String(error) });
      if (!response.headersSent) replyWithJsonRpcError(response, 500, 'Internal error');
      else response.end();
    });
  });
  const address = await listen(server);
  host = `127.0.0.1:${address.port}`;
  const url = `http://${host}${MCP_PATH}`;
  log.info('chord-mcp endpoint: listening', { url });
  return { url };
}

/** The endpoint's URL, starting it on first use. It lives as long as the app. */
export function ensureChordMcpEndpoint(): Promise<{ url: string }> {
  if (!endpoint) {
    endpoint = startEndpoint();
    // A failed start is not cached: the next session tries again.
    endpoint.catch(() => {
      endpoint = null;
    });
  }
  return endpoint;
}
