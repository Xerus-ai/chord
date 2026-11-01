import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HookCallbackMatcher, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeDirSync } from '@main/lib/remove-dir-sync';

/**
 * The Claude SDK publish nudge (plan 2026-09-23 §4 P4 step 1), given on the
 * write itself: the first time a turn writes a document that is not an
 * artifact, the tool result carries a note asking the agent to publish it if
 * it is a deliverable. It used to block the turn's Stop instead, which made
 * Claude answer every file-writing turn twice ("OK", "OK") or explain why it
 * was not publishing (devstation-fo4u). The hooks are the callbacks the SDK
 * invokes, driven here with the payloads the CLI sends, against real SQLite
 * and real files.
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
const { publishArtifact } = await import('@main/core/agent-artifact-tools/publish-artifact');
const { buildPublishNudgeHooks } = await import('./publish-nudge-hooks');

const WORK_ITEM_ID = 'w-nudge';
let root: string;
let repoDir: string;

beforeAll(async () => {
  await signInTestAccount({ username: 'ada', email: 'ada@example.com' });
  root = mkdtempSync(join(tmpdir(), 'chord-nudge-'));
  repoDir = join(root, 'repo');
  mkdirSync(join(repoDir, 'docs'), { recursive: true });
  writeFileSync(join(repoDir, 'notes.md'), '# Notes');
  writeFileSync(join(repoDir, 'docs', 'plan.md'), '# Plan');
  writeFileSync(join(repoDir, 'index.ts'), 'export {};');
  await db.insert(repos).values({ id: 'r-nudge', alias: 'repo', path: repoDir });
  await db.insert(workItems).values({
    id: WORK_ITEM_ID,
    repoId: 'r-nudge',
    repoPath: repoDir,
    name: 'Nudge',
  });
});

afterAll(() => {
  removeDirSync(root);
});

beforeEach(() => {
  db.delete(artifacts).run();
});

const BASE = { session_id: 'sdk-session', transcript_path: '/dev/null', cwd: '' };

function runHooks(matchers: HookCallbackMatcher[] | undefined, input: HookInput) {
  if (!matchers) throw new Error(`no ${input.hook_event_name} hook registered`);
  const signal = new AbortController().signal;
  return Promise.all(
    matchers.flatMap((m) => m.hooks.map((hook) => hook(input, undefined, { signal })))
  );
}

function build() {
  const hooks = buildPublishNudgeHooks({ workItemId: WORK_ITEM_ID, cwd: repoDir });
  return {
    hooks,
    write: async (toolName: string, filePath: string) => {
      const [output] = await runHooks(hooks.PostToolUse, {
        ...BASE,
        cwd: repoDir,
        hook_event_name: 'PostToolUse',
        tool_name: toolName,
        tool_input: { file_path: filePath, content: '# x' },
        tool_response: {},
        tool_use_id: `tu-${Math.random()}`,
      });
      return output as { hookSpecificOutput?: { additionalContext?: string } };
    },
  };
}

const noteOf = (output: { hookSpecificOutput?: { additionalContext?: string } }) =>
  output.hookSpecificOutput?.additionalContext;

describe('publish nudge', () => {
  it('asks once, on the write, to publish a document if it is a deliverable, and to say nothing otherwise', async () => {
    const turn = build();

    const note = noteOf(await turn.write('Write', 'notes.md'));

    expect(note).toContain(join(repoDir, 'notes.md'));
    expect(note).toContain('publish_artifact');
    expect(note).toMatch(/without mentioning/i);
    expect(note).not.toMatch(/say why/i);
    // Asked on the first write, the document may still be a draft: publish
    // it once it is finished, and a later publish updates it (devstation-v3p5).
    expect(note).toMatch(/once it is finished/i);
    expect(note).toMatch(/publishing it again updates it/i);
    // The same document written again is not asked about again.
    expect(noteOf(await turn.write('Edit', 'notes.md'))).toBeUndefined();
  });

  it('never blocks the turn from ending', () => {
    expect(build().hooks.Stop).toBeUndefined();
  });

  it('does not ask about a document that already is an artifact', async () => {
    await publishArtifact(
      { sessionId: 's-nudge', workItemId: WORK_ITEM_ID, cwd: repoDir },
      { path: 'docs/plan.md' }
    );
    expect(noteOf(await build().write('Edit', join(repoDir, 'docs', 'plan.md')))).toBeUndefined();
  });

  it('ignores code, reads, and machinery outside the workspace', async () => {
    const turn = build();
    for (const [tool, path] of [
      ['Write', 'index.ts'],
      ['Read', 'notes.md'],
      ['Write', join(root, 'outside.md')],
      ['Write', join(repoDir, '.claude', 'plans', 'draft.md')],
    ]) {
      expect(noteOf(await turn.write(tool, path)), path).toBeUndefined();
    }
  });
});
