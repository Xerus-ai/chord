import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  buildChordMcpShim,
  CHORD_MCP_OUT_DIR,
} from '../../../../scripts/chord-mcp/chord-mcp-shim-plugin.mjs';

/**
 * The loopback endpoint and the stdio shim, end to end: a real HTTP server on
 * 127.0.0.1, the MCP SDK's own client over HTTP and over stdio (the built shim
 * spawned as a child process), and real SQLite from the shipped migrations
 * (the repo's standard substitution, see publish-artifact.test.ts).
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { signInTestAccount } = await import('@main/core/account/_testing/test-account');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { appSettingsService } = await import('@main/core/settings/settings-service');
const { ensureChordMcpEndpoint } = await import('./chord-mcp-endpoint');
const { registerArtifactToolSession } = await import('./artifact-tool-sessions');

const WORK_ITEM_ID = 'w-endpoint';

let root: string;
let repoDir: string;
let url: string;
let shimPath: string;
const published: string[] = [];

function openSession() {
  return registerArtifactToolSession({
    sessionId: 's-endpoint',
    workItemId: WORK_ITEM_ID,
    cwd: repoDir,
    preferredFormat: 'web',
    onPublished: (result) => published.push(result.path),
  });
}

async function connectOverHttp(token: string): Promise<Client> {
  const client = new Client({ name: 'endpoint-test', version: '0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return client;
}

async function connectOverShim(token: string): Promise<Client> {
  const client = new Client({ name: 'shim-test', version: '0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [shimPath],
    env: { CHORD_MCP_URL: url, CHORD_MCP_TOKEN: token },
    stderr: 'pipe',
  });
  // devstation-wjm: under full-suite load the shim has once exited early
  // ("Connection closed"). A failing test prints what it said and when it
  // went away, which the SDK's error does not carry.
  let shimStderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    shimStderr += chunk.toString();
  });
  let closedAt: string | null = null;
  // Set before connect: the SDK's Protocol.connect chains an existing onclose.
  transport.onclose = () => {
    closedAt = new Date().toISOString();
  };
  onTestFailed(() => {
    console.error(
      `chord-mcp shim closed at ${closedAt ?? 'still open'}; stderr:\n${shimStderr || '(empty)'}`
    );
  });
  await client.connect(transport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  root = mkdtempSync(join(tmpdir(), 'chord-endpoint-'));
  repoDir = join(root, 'repo');
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, 'plan.md'), '# Plan\n\nShip it.');

  await db.insert(repos).values({ id: 'r-endpoint', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-endpoint',
    repoPath: repoDir,
    name: 'Endpoint',
  });

  ({ url } = await ensureChordMcpEndpoint());
  await buildChordMcpShim();
  shimPath = join(CHORD_MCP_OUT_DIR, 'chord-mcp-stdio.cjs');
}, 60_000);

afterAll(() => {
  removeDirSync(root);
});

beforeEach(async () => {
  db.delete(artifacts).run();
  published.length = 0;
  await appSettingsService.reset('artifacts');
});

describe('the loopback endpoint', () => {
  it('listens on 127.0.0.1 only', () => {
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it('refuses a request with no token or an unknown one before any tool runs', async () => {
    const post = (headers: Record<string, string>) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ Authorization: 'Bearer not-a-session' })).status).toBe(401);
  });

  it("serves the session's tools, with its preferred format in the description", async () => {
    const session = openSession();
    const client = await connectOverHttp(session.token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['list_artifacts', 'publish_artifact']);
    const publish = tools.find((t) => t.name === 'publish_artifact')!;
    expect(publish.description).toContain('The user prefers Web page (.html)');
    expect(Object.keys(publish.inputSchema.properties ?? {})).not.toContain('work_item_id');
    await client.close();
    session.dispose();
  });

  it('publishes into the work item the token names, and republishing updates it', async () => {
    const session = openSession();
    const client = await connectOverHttp(session.token);
    const first = await client.callTool({
      name: 'publish_artifact',
      arguments: { path: 'plan.md' },
    });
    const second = await client.callTool({
      name: 'publish_artifact',
      arguments: { path: 'plan.md' },
    });
    expect(JSON.parse(textOf(first))).toMatchObject({ created: true, format: 'markdown' });
    expect(JSON.parse(textOf(second))).toMatchObject({ created: false });
    expect(db.select().from(artifacts).all()).toHaveLength(1);
    expect(published).toEqual([join(repoDir, 'plan.md'), join(repoDir, 'plan.md')]);
    await client.close();
    session.dispose();
  });
});

describe('the stdio shim', () => {
  it('carries a stdio client to the endpoint and back', async () => {
    const session = openSession();
    const client = await connectOverShim(session.token);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('publish_artifact');
    const result = await client.callTool({
      name: 'publish_artifact',
      arguments: { path: 'plan.md' },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toMatchObject({ created: true });
    await client.close();
    session.dispose();
  }, 30_000);

  it('answers with the reason when the session has ended, instead of hanging', async () => {
    const session = openSession();
    const client = await connectOverShim(session.token);
    session.dispose();
    await expect(client.listTools()).rejects.toThrow(/Chord refused the request \(401\)/);
    await client.close();
  }, 30_000);
});
