import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  encodeClaudeProjectDir,
  resolveClaudeResumeId,
  resolveClaudeTranscriptPath,
} from './claude-conversation-store';

// A real Claude config directory: one project with one persisted conversation.
const configDir = mkdtempSync(join(tmpdir(), 'claude-config-'));
const cwd = 'D:\\Work\\chord';
const kept = '11111111-1111-4111-8111-111111111111';
const pruned = '9d517381-0000-4000-8000-000000000000';
mkdirSync(join(configDir, 'projects', 'D--Work-chord'), { recursive: true });
writeFileSync(join(configDir, 'projects', 'D--Work-chord', `${kept}.jsonl`), '{}\n');
const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = configDir;

/**
 * A lane path whose encoding is 211 characters — past the 200 the SDK keeps.
 * The expected directory name below follows the SDK 0.3.265 naming rule as
 * Chord's own implementation states it (claude-conversation-store.ts): the
 * first 200 encoded characters, `-`, then `Math.abs(hash(cwd)).toString(36)`
 * of a 31-multiplier string hash.
 */
const longCwd =
  'C:\\Users\\dev\\chord\\worktrees\\payments-service-monorepo\\payments-service-monorepo\\payments-service-monorepo\\payments-service-monorepo\\raghav\\eng-4242-migrate-the-ledger-reconciliation-job-to-the-new-scheduler-a3f';
const longDir =
  'C--Users-dev-chord-worktrees-payments-service-monorepo-payments-service-monorepo-payments-service-monorepo-payments-service-monorepo-raghav-eng-4242-migrate-the-ledger-reconciliation-job-to-the-new-sc-3oz64a';

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
  removeDirSync(configDir);
});

describe('encodeClaudeProjectDir', () => {
  it('replaces every character outside [A-Za-z0-9] with -', () => {
    expect(encodeClaudeProjectDir('D:\\Work\\chord')).toBe('D--Work-chord');
    expect(encodeClaudeProjectDir('/home/dev/my_repo.v2')).toBe('-home-dev-my-repo-v2');
  });

  it('keeps an encoding of exactly 200 characters whole', () => {
    const cwd200 = `C:\\${'x'.repeat(197)}`;
    expect(encodeClaudeProjectDir(cwd200)).toBe(`C--${'x'.repeat(197)}`);
  });

  it('caps a longer encoding at 200 characters plus the SDK hash suffix', () => {
    expect(encodeClaudeProjectDir(longCwd)).toBe(longDir);
    expect(encodeClaudeProjectDir(`C:\\${'x'.repeat(198)}`)).toBe(`C--${'x'.repeat(197)}-gi8wd7`);
  });
});

describe('resolveClaudeResumeId', () => {
  it('resumes a conversation Claude Code still has', () => {
    expect(resolveClaudeResumeId(cwd, true, kept)).toBe(kept);
  });

  it('starts fresh when the conversation was pruned', () => {
    expect(resolveClaudeResumeId(cwd, true, pruned)).toBeUndefined();
  });

  it('starts fresh when the conversation lives under another directory', () => {
    expect(resolveClaudeResumeId('D:\\Work\\other', true, kept)).toBeUndefined();
  });

  it('starts fresh when no resume was asked for, or there is no id', () => {
    expect(resolveClaudeResumeId(cwd, false, kept)).toBeUndefined();
    expect(resolveClaudeResumeId(cwd, true, undefined)).toBeUndefined();
  });
});

describe('a lane path longer than the 200-character cap', () => {
  const longSession = '22222222-2222-4222-8222-222222222222';
  const cliSession = '33333333-3333-4333-8333-333333333333';
  // The SDK's own directory for the path.
  mkdirSync(join(configDir, 'projects', longDir), { recursive: true });
  writeFileSync(join(configDir, 'projects', longDir, `${longSession}.jsonl`), '{}\n');
  // The CLI runs under Bun and hashes the tail with Bun.hash, so a conversation
  // `claude` wrote can sit under the same 200-character prefix with another
  // suffix; the SDK finds it by that prefix (`sdk.mjs` `ir`/`oR`), and so must Chord.
  const cliDir = `${longDir.slice(0, 200)}-1k2v9qz`;
  mkdirSync(join(configDir, 'projects', cliDir), { recursive: true });
  writeFileSync(join(configDir, 'projects', cliDir, `${cliSession}.jsonl`), '{}\n');

  it('resumes a conversation stored under the SDK directory', () => {
    expect(resolveClaudeResumeId(longCwd, true, longSession)).toBe(longSession);
  });

  it('resumes a conversation stored under the same prefix with the CLI hash', () => {
    expect(resolveClaudeResumeId(longCwd, true, cliSession)).toBe(cliSession);
    expect(resolveClaudeTranscriptPath(longCwd, cliSession)).toBe(
      join(configDir, 'projects', cliDir, `${cliSession}.jsonl`)
    );
  });

  it('starts fresh when no directory under the prefix has the conversation', () => {
    expect(resolveClaudeResumeId(longCwd, true, pruned)).toBeUndefined();
    expect(resolveClaudeTranscriptPath(longCwd, pruned)).toBeNull();
  });

  it('never matches a prefix directory of a different path', () => {
    // Same first 200 encoded characters only if the paths share them; a path
    // that differs inside the prefix must not find the long lane's session.
    const other = longCwd.replace('payments', 'billings');
    expect(resolveClaudeResumeId(other, true, longSession)).toBeUndefined();
  });
});

describe('resolveClaudeTranscriptPath', () => {
  it('names the transcript file for a short path', () => {
    expect(resolveClaudeTranscriptPath(cwd, kept)).toBe(
      join(configDir, 'projects', 'D--Work-chord', `${kept}.jsonl`)
    );
  });

  it('is null when the conversation is gone', () => {
    expect(resolveClaudeTranscriptPath(cwd, pruned)).toBeNull();
  });
});
