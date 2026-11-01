import { describe, expect, it } from 'vitest';
import { formatClaudeDefinitions } from './claude-definitions-text';

/** How the trust prompt and Repo › Trust show skill/agent/command code: one block per file. */
describe('formatClaudeDefinitions', () => {
  it('lists each file by path, sorted, with its code indented under it', () => {
    expect(
      formatClaudeDefinitions({
        'b/.claude/commands/x.md': '!`b`',
        '.claude/agents/r.md': 'mcpServers:\n  db:\n    command: node',
      })
    ).toBe(
      '.claude/agents/r.md\n  mcpServers:\n    db:\n      command: node\n\nb/.claude/commands/x.md\n  !`b`'
    );
  });
});
