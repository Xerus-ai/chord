import type { AgentLatestSource } from '@shared/agent-updates';

/** The release channel Codex's native installer reads (`scripts/install/install.ps1`). */
export const CODEX_LATEST_CHANNEL_URL = 'https://releases.openai.com/codex/channels/latest';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const CODEX_TAG_PREFIX = 'rust-v';
const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson(url: string, what: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`${what}: ${url} answered ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchCodexChannelLatest(url: string): Promise<string> {
  const body = (await fetchJson(url, 'Codex release channel')) as { tag_name?: unknown };
  const tag = body.tag_name;
  if (typeof tag !== 'string' || !tag.startsWith(CODEX_TAG_PREFIX)) {
    throw new Error(`Codex release channel ${url} has no rust-v tag: ${JSON.stringify(tag)}`);
  }
  return tag.slice(CODEX_TAG_PREFIX.length);
}

async function fetchNpmLatest(pkg: string): Promise<string> {
  // A scoped name keeps its `@` and encodes its `/`: `@openai%2fcodex`.
  const url = `${NPM_REGISTRY_URL}/${pkg.replace('/', '%2f')}/latest`;
  const body = (await fetchJson(url, `npm package ${pkg}`)) as { version?: unknown };
  if (typeof body.version !== 'string') {
    throw new Error(`npm package ${pkg}: ${url} has no version`);
  }
  return body.version;
}

/** The latest released version of an agent CLI, read live from its release source. */
export function fetchLatestVersion(source: AgentLatestSource): Promise<string> {
  switch (source.kind) {
    case 'codex-channel':
      return fetchCodexChannelLatest(source.url);
    case 'npm':
      return fetchNpmLatest(source.package);
  }
}
