import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Encoded cwds longer than this are cut and suffixed with a hash (SDK `Rs`). */
const MAX_ENCODED_LENGTH = 200;

/** The SDK's 31-multiplier string hash (`dT` in `@anthropic-ai/claude-agent-sdk/sdk.mjs`). */
function hashPath(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return hash;
}

/**
 * The project directory Claude keeps `cwd`'s transcripts in — the SDK 0.3.265
 * rule (`rm`): every character outside [A-Za-z0-9] becomes '-'
 * (`D:\Kami` -> `D--Kami`), and an encoding past 200 characters keeps its
 * first 200 plus `-<base36 hash of cwd>`.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, '-');
  if (encoded.length <= MAX_ENCODED_LENGTH) return encoded;
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${Math.abs(hashPath(cwd)).toString(36)}`;
}

export function claudeConfigDir(): string {
  const explicit = process.env.CLAUDE_CONFIG_DIR?.trim();
  return explicit ? explicit : join(homedir(), '.claude');
}

/**
 * Directories that can hold `cwd`'s transcripts: the SDK's own name, and for a
 * long path every directory sharing its 200-character prefix — the CLI runs
 * under Bun and hashes the tail with `Bun.hash`, so the SDK looks them up by
 * prefix too (`sdk.mjs` `ir`). Case-insensitive on Windows, as there.
 */
function candidateProjectDirs(cwd: string): string[] {
  const projects = join(claudeConfigDir(), 'projects');
  const exact = encodeClaudeProjectDir(cwd);
  const dirs = [join(projects, exact)];
  if (exact.length <= MAX_ENCODED_LENGTH || !existsSync(projects)) return dirs;
  const fold = (name: string) => (process.platform === 'win32' ? name.toLowerCase() : name);
  const prefix = fold(`${exact.slice(0, MAX_ENCODED_LENGTH)}-`);
  for (const entry of readdirSync(projects, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== exact && fold(entry.name).startsWith(prefix)) {
      dirs.push(join(projects, entry.name));
    }
  }
  return dirs;
}

/** The transcript of `externalSessionId` for `cwd`, or null when Claude Code has none. */
export function resolveClaudeTranscriptPath(cwd: string, externalSessionId: string): string | null {
  for (const dir of candidateProjectDirs(cwd)) {
    const file = join(dir, `${externalSessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * True when `claude --resume <externalSessionId>` run in `cwd` will find a
 * conversation. The CLI persists one JSONL per session under
 * `~/.claude/projects/<encoded cwd>/` — a session id that was only reserved
 * via `--session-id` (terminal opened, nothing exchanged) has no file, and
 * resuming it dies with "No conversation found with session ID".
 */
export function claudeConversationExists(cwd: string, externalSessionId: string): boolean {
  return resolveClaudeTranscriptPath(cwd, externalSessionId) !== null;
}

/**
 * The conversation a Claude launch can resume: the one asked for, if Claude
 * Code still has it. It prunes old transcripts (`cleanupPeriodDays`) and an id
 * only reserved has none; resuming either ends the session with "No
 * conversation found", so such a launch starts a fresh conversation instead.
 */
export function resolveClaudeResumeId(
  cwd: string,
  isResuming: boolean,
  externalSessionId: string | undefined
): string | undefined {
  if (!isResuming || externalSessionId === undefined) return undefined;
  return claudeConversationExists(cwd, externalSessionId) ? externalSessionId : undefined;
}
