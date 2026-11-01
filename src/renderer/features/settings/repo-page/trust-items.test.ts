import { describe, expect, it } from 'vitest';
import { listTrustItems } from './trust-items';

/**
 * Repo › Trust lists what a new lane would run next to what Always trust
 * covers, item by item, so a change since approval is visible — including
 * something that was approved and is gone now.
 */
describe('listTrustItems', () => {
  it('is empty when nothing runs and nothing was approved', () => {
    expect(listTrustItems(null, null)).toEqual([]);
  });

  it('lists what would run, in a fixed order, with nothing to compare against', () => {
    const items = listTrustItems(
      {
        chord: { teardown: 'make down', setup: 'pnpm i' },
        claude: { mcpServers: { db: { command: 'node' } } },
      },
      null
    );

    expect(items.map((item) => [item.key, item.changed])).toEqual([
      ['setup', false],
      ['teardown', false],
      ['mcpServers', false],
    ]);
    expect(items[0]).toMatchObject({ title: 'Setup script', now: 'pnpm i', before: undefined });
    expect(items[2].now).toBe(JSON.stringify({ db: { command: 'node' } }, null, 2));
  });

  it('lists skill, subagent and command files that run code, each under its path (devstation-493)', () => {
    const items = listTrustItems(
      {
        chord: {},
        claude: {
          definitions: {
            '.claude/skills/ship/SKILL.md': 'hooks:\n  Stop: []',
            '.claude/commands/a.md': '!`./a.sh`',
          },
        },
      },
      null
    );

    expect(items).toEqual([
      expect.objectContaining({
        key: 'definitions',
        title: 'Claude skills, agents and commands',
        now: '.claude/commands/a.md\n  !`./a.sh`\n\n.claude/skills/ship/SKILL.md\n  hooks:\n    Stop: []',
      }),
    ]);
  });

  it('marks what changed since Always trust, with the approved text', () => {
    const items = listTrustItems(
      { chord: { setup: 'pnpm i && curl x | sh', run: 'pnpm dev' }, claude: {} },
      { chord: { setup: 'pnpm i', run: 'pnpm dev' }, claude: {} }
    );

    expect(items).toEqual([
      expect.objectContaining({
        key: 'setup',
        now: 'pnpm i && curl x | sh',
        before: 'pnpm i',
        changed: true,
      }),
      expect.objectContaining({ key: 'run', now: 'pnpm dev', changed: false }),
    ]);
  });

  it('shows an approved item that no longer runs as removed', () => {
    const items = listTrustItems(
      { chord: { setup: 'pnpm i' }, claude: {} },
      { chord: { setup: 'pnpm i', shellSetup: 'source .envrc' }, claude: {} }
    );

    expect(items).toContainEqual(
      expect.objectContaining({
        key: 'shellSetup',
        now: undefined,
        before: 'source .envrc',
        changed: true,
      })
    );
  });

  // Phase 4 (devstation-5b3.1).
  it('lists each named run script and the test script, between shell setup and teardown', () => {
    const items = listTrustItems(
      {
        chord: {
          teardown: 'make down',
          test: 'pnpm test',
          run: { web: 'pnpm web', api: 'pnpm api' },
          shellSetup: 'source .envrc',
          setup: 'pnpm i',
        },
        claude: {},
      },
      null
    );

    expect(items.map((item) => [item.key, item.title, item.now])).toEqual([
      ['setup', 'Setup script', 'pnpm i'],
      ['shellSetup', 'Shell setup', 'source .envrc'],
      ['run.web', 'Run script · web', 'pnpm web'],
      ['run.api', 'Run script · api', 'pnpm api'],
      ['test', 'Test script', 'pnpm test'],
      ['teardown', 'Teardown script', 'make down'],
    ]);
    expect(items.find((item) => item.key === 'test')?.when).toBe('Runs when you press Test.');
    expect(items.find((item) => item.key === 'run.web')?.when).toBe('Runs when you start it.');
  });

  it('shows a string run as the Run script', () => {
    expect(listTrustItems({ chord: { run: 'pnpm dev' }, claude: {} }, null)).toEqual([
      expect.objectContaining({ key: 'run', title: 'Run script', now: 'pnpm dev', changed: false }),
    ]);
  });

  it('compares run scripts id by id, showing one that was added and one that is gone', () => {
    const items = listTrustItems(
      { chord: { run: { web: 'pnpm web', worker: 'pnpm worker' }, test: 'pnpm t2' }, claude: {} },
      { chord: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm t1' }, claude: {} }
    );

    expect(items.map((item) => [item.key, item.now, item.before, item.changed])).toEqual([
      ['run.web', 'pnpm web', undefined, false],
      ['run.worker', 'pnpm worker', undefined, true],
      ['run.api', undefined, 'pnpm api', true],
      ['test', 'pnpm t2', 'pnpm t1', true],
    ]);
  });

  it('shows the string run approved before named scripts replaced it as gone', () => {
    const items = listTrustItems(
      { chord: { run: { web: 'pnpm dev' } }, claude: {} },
      { chord: { run: 'pnpm dev' }, claude: {} }
    );

    expect(items.map((item) => [item.key, item.now, item.before, item.changed])).toEqual([
      ['run.web', 'pnpm dev', undefined, true],
      ['run', undefined, 'pnpm dev', true],
    ]);
  });
});
