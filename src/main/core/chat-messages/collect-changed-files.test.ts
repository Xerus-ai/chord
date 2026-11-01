import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StreamItem, ToolCallItem } from '@shared/stream-items';
import type { AgentPathEnvironment } from '@main/utils/agent-reported-path';
import { collectChangedFiles } from './collect-changed-files';

// The Windows cases translate against a Windows worktree under %TEMP%
// spelled out, whatever host runs the suite: a real `os.tmpdir()` is a POSIX
// path on Linux CI and would not be a Windows case. Nothing here reads disk.
const tempDir = 'C:\\Users\\dev\\AppData\\Local\\Temp';
const repoPath = `${tempDir}\\chord-changed-files-L2V6JM`;

const windows: AgentPathEnvironment = { platform: 'win32', tempDir };

/** How Git Bash prints a directory that lives under the Windows temp dir. */
function msysTempForm(dir: string): string {
  return `/tmp${dir.slice(tempDir.length).replace(/\\/g, '/')}`;
}

function editTool(overrides: Partial<ToolCallItem>): StreamItem {
  return {
    kind: 'tool_group',
    id: 'group-1',
    tools: [
      {
        callId: 'call-1',
        name: 'Write',
        status: 'completed',
        kind: 'edit',
        ...overrides,
      },
    ],
  };
}

describe('collectChangedFiles', () => {
  it('translates the MSYS path a Write tool reported into the repo file', () => {
    const items = [editTool({ rawInput: { file_path: `${msysTempForm(repoPath)}/src/notes.md` } })];

    expect(collectChangedFiles(items, repoPath, windows)).toEqual([
      {
        name: 'notes.md',
        filePath: path.win32.join(repoPath, 'src', 'notes.md'),
        added: 0,
        removed: 0,
      },
    ]);
  });

  it('translates a tool-reported location and counts the diff lines', () => {
    const items = [
      editTool({
        locations: [{ filePath: '/d/code/app/main.ts' }],
        contentBlocks: [{ type: 'diff', diff: '+added\n+another\n-gone\n+++ header\n--- header' }],
      }),
    ];

    expect(collectChangedFiles(items, 'C:\\repo', windows)).toEqual([
      { name: 'main.ts', filePath: 'D:\\code\\app\\main.ts', added: 2, removed: 1 },
    ]);
  });

  it('reports one entry when a location and a later call name the same file', () => {
    const posixPath = `${msysTempForm(repoPath)}/notes.md`;
    const items: StreamItem[] = [
      {
        kind: 'tool_group',
        id: 'group-1',
        tools: [
          {
            callId: 'a',
            name: 'Write',
            status: 'completed',
            kind: 'edit',
            locations: [{ filePath: posixPath }],
          },
          {
            callId: 'b',
            name: 'Edit',
            status: 'completed',
            kind: 'edit',
            rawInput: { file_path: path.win32.join(repoPath, 'notes.md') },
          },
        ],
      },
    ];

    expect(collectChangedFiles(items, repoPath, windows)).toHaveLength(1);
  });

  it('ignores tools that did not edit a file', () => {
    const items = [
      editTool({ kind: 'execute', rawInput: { command: 'ls /tmp' } }),
      { kind: 'text', id: 't1', text: 'wrote /tmp/notes.md' } as StreamItem,
    ];

    expect(collectChangedFiles(items, repoPath, windows)).toEqual([]);
  });

  it('anchors a relative reported path on the session workspace', () => {
    const items = [editTool({ rawInput: { path: 'docs/plan.md' } })];

    expect(collectChangedFiles(items, 'C:\\repo', windows)).toEqual([
      { name: 'plan.md', filePath: 'C:\\repo\\docs\\plan.md', added: 0, removed: 0 },
    ]);
  });
});
