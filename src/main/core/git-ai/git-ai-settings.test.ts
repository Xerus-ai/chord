import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIT_AI_AGENTS, type GitAiOverride, type GitAiSettings } from '@shared/git-ai';
import { updateJustMeSettings } from '@main/core/repo-config/repo-settings-writes';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { appSettingsSchema } from '@main/core/settings/schema';
import { getDefaultForKey } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { repos } from '@main/db/schema-work-items';
import { readGitAiSettings } from './git-ai-settings';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const REPO_ID = 'repo-git-ai';

const CODEX: GitAiSettings = {
  agent: 'codex',
  model: 'gpt-5.4-mini',
  instructions: { commit: 'Prefix the subject with the ticket key.', pr: '' },
  prDefaults: { draft: true, useTemplate: false, openAfterCreate: true },
};

const YOU: GitAiSettings = {
  ...getDefaultForKey('gitAi'),
  model: 'sonnet',
  instructions: { commit: 'Use Conventional Commits.', pr: 'Keep it short.' },
};

/**
 * Settings › Git › AI (plan 2026-09-26, settings table row `gitAi`): the
 * user's own agent writes commit messages and PR text. Resolution is per
 * field: built-in < You (app DB) < this repository's just-me override
 * (`repo_settings.overrides.gitAi`), which sets only the fields it names —
 * agent, model, each instruction and each PR default inherit otherwise.
 */
describe('gitAi setting', () => {
  beforeEach(() => {
    db.insert(repos).values({ id: REPO_ID, path: '/repo', alias: 'repo' }).run();
  });

  afterEach(async () => {
    db.delete(repos).run();
    await appSettingsService.reset('gitAi');
  });

  it('defaults to the default agent (Claude) with its own model, no instructions, draft off and the template on', () => {
    expect(getDefaultForKey('gitAi')).toEqual({
      agent: 'claude',
      model: null,
      instructions: { commit: '', pr: '' },
      prDefaults: { draft: false, useTemplate: true, openAfterCreate: false },
    });
  });

  it("accepts Claude, Codex and the registry's ACP agents, and no terminal-only agent", () => {
    const schema = appSettingsSchema.shape.gitAi;
    expect(GIT_AI_AGENTS).toEqual(expect.arrayContaining(['claude', 'codex', 'opencode', 'goose']));
    expect(schema.parse(CODEX)).toEqual(CODEX);
    expect(schema.parse({ ...CODEX, agent: 'opencode' }).agent).toBe('opencode');
    // Gemini runs only in a terminal; OpenRouter is no agent at all.
    expect(schema.safeParse({ ...CODEX, agent: 'gemini' }).success).toBe(false);
    expect(schema.safeParse({ ...CODEX, agent: 'openrouter' }).success).toBe(false);
  });

  it('reads the built-in value, every field named as such, when nothing is set', async () => {
    const resolved = await readGitAiSettings(REPO_ID);
    expect(resolved.value).toEqual(getDefaultForKey('gitAi'));
    expect(new Set(Object.values(resolved.layers))).toEqual(new Set(['default']));
  });

  it('names the fields the user changed (You), and only those', async () => {
    await appSettingsService.update('gitAi', YOU);
    const resolved = await readGitAiSettings(REPO_ID);
    expect(resolved.value).toEqual(YOU);
    expect(resolved.layers).toEqual({
      agent: 'default',
      model: 'you',
      'instructions.commit': 'you',
      'instructions.pr': 'you',
      'prDefaults.draft': 'default',
      'prDefaults.useTemplate': 'default',
      'prDefaults.openAfterCreate': 'default',
    });
  });

  it('a repository override sets only the fields it names; the rest inherit from You', async () => {
    await appSettingsService.update('gitAi', YOU);
    const override: GitAiOverride = {
      agent: 'codex',
      instructions: { pr: 'Name the ticket.' },
      prDefaults: { draft: true },
    };
    updateJustMeSettings(REPO_ID, { gitAi: override });

    const resolved = await readGitAiSettings(REPO_ID);
    expect(resolved.value).toEqual({
      agent: 'codex',
      model: 'sonnet',
      instructions: { commit: 'Use Conventional Commits.', pr: 'Name the ticket.' },
      prDefaults: { draft: true, useTemplate: true, openAfterCreate: false },
    });
    expect(resolved.layers).toEqual({
      agent: 'justMe',
      model: 'you',
      'instructions.commit': 'you',
      'instructions.pr': 'justMe',
      'prDefaults.draft': 'justMe',
      'prDefaults.useTemplate': 'default',
      'prDefaults.openAfterCreate': 'default',
    });
  });

  it('an override applies to its repository only', async () => {
    updateJustMeSettings(REPO_ID, { gitAi: { agent: 'codex' } });
    expect((await readGitAiSettings(REPO_ID)).value.agent).toBe('codex');
    expect((await readGitAiSettings(null)).value.agent).toBe('claude');
    expect((await readGitAiSettings(null)).layers.agent).toBe('default');
  });

  it("an override can pin the agent's own model (null) over a You model", async () => {
    await appSettingsService.update('gitAi', YOU);
    updateJustMeSettings(REPO_ID, { gitAi: { model: null } });
    const resolved = await readGitAiSettings(REPO_ID);
    expect(resolved.value.model).toBeNull();
    expect(resolved.layers.model).toBe('justMe');
  });

  it('clearing the override (null) brings every field back to You', async () => {
    await appSettingsService.update('gitAi', YOU);
    updateJustMeSettings(REPO_ID, { gitAi: CODEX });
    updateJustMeSettings(REPO_ID, { gitAi: null });

    expect(readJustMeSettings(REPO_ID).gitAi).toBeUndefined();
    expect((await readGitAiSettings(REPO_ID)).value).toEqual(YOU);
  });

  it('refuses an override naming an agent that cannot run a one-shot prompt, and stores nothing', () => {
    expect(() =>
      updateJustMeSettings(REPO_ID, { gitAi: { agent: 'gemini' as GitAiSettings['agent'] } })
    ).toThrow();
    expect(readJustMeSettings(REPO_ID).gitAi).toBeUndefined();
  });
});
