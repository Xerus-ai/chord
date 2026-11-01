import { randomUUID } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';

/**
 * Codex's folder trust for a Chord lane (devstation-xr1). A Codex terminal in
 * a lane opened on Codex's own "Do you trust the contents of this directory?"
 * prompt; Chord already decides what may run from the repository (plan
 * 2026-09-26, trust decisions), as it does for Claude
 * (`claude-trust-service.ts`).
 *
 * Trust is a `[projects."<path>"] trust_level` table in Codex's
 * `config.toml`, which Codex writes when the user accepts. It cannot ride on a
 * `-c` override: Codex splits an override's key on every "." and does not read
 * quoted segments (codex-rs `common/src/config_override.rs`). Codex 0.154
 * matches the lane's plain path (probe `chord-lane-checks/probe-xr1`).
 *
 * A trusted folder also loads the repository's own `.codex/config.toml`,
 * which can start MCP servers, so a lane that has one is left for Codex to
 * ask about. A decision the config already holds is the user's and stays.
 */

export type CodexLaneTrust = 'trusted' | 'already_decided' | 'repository_config';

const REPOSITORY_CODEX_CONFIG = path.join('.codex', 'config.toml');

/** The key Codex looks the lane up by: its absolute path as the OS spells it. */
export function codexProjectKey(cwd: string): string {
  return path.resolve(cwd);
}

export async function trustCodexLane({
  cwd,
  codexHome,
}: {
  cwd: string;
  codexHome: string;
}): Promise<CodexLaneTrust> {
  if (existsSync(path.join(cwd, REPOSITORY_CODEX_CONFIG))) return 'repository_config';

  const configPath = path.join(codexHome, 'config.toml');
  const current = await readConfigText(configPath);
  const key = codexProjectKey(cwd);
  if (readTrustLevel(current, configPath, key) !== undefined) return 'already_decided';

  const separator = current === '' || current.endsWith('\n') ? '' : '\n';
  const next = `${current}${separator}\n[projects.${JSON.stringify(key)}]\ntrust_level = "trusted"\n`;
  if (readTrustLevel(next, configPath, key) !== 'trusted') {
    throw new Error(`Could not add the lane's trust to ${configPath} as valid TOML`);
  }
  await fs.mkdir(codexHome, { recursive: true });
  await writeFileAtomic(configPath, next);
  return 'trusted';
}

async function readConfigText(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function readTrustLevel(text: string, configPath: string, key: string): string | undefined {
  let config: Record<string, unknown>;
  try {
    config = parse(text);
  } catch (error: unknown) {
    throw new Error(`Codex's ${configPath} is not valid TOML: ${String(error)}`);
  }
  const projects = config.projects as Record<string, { trust_level?: unknown }> | undefined;
  const level = projects?.[key]?.trust_level;
  return typeof level === 'string' ? level : undefined;
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temp = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, filePath);
}
