import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveAgentReportedPath,
  type AgentPathEnvironment,
} from '@main/utils/agent-reported-path';

// The translation is pure string work, so the Windows cases use a Windows
// temp directory and repo spelled out, whatever host runs the suite: a real
// `os.tmpdir()` is a POSIX path on Linux CI and would not be a Windows case.
const tempDir = 'C:\\Users\\dev\\AppData\\Local\\Temp';
const repoPath = `${tempDir}\\chord-agent-path-9XS9ZI`;

const windows: AgentPathEnvironment = { platform: 'win32', tempDir };
const posix: AgentPathEnvironment = { platform: 'linux', tempDir: '/tmp' };

/** How Git Bash prints `dir` when it lives under the Windows temp directory. */
function msysTempForm(dir: string): string {
  return `/tmp${dir.slice(tempDir.length).replace(/\\/g, '/')}`;
}

describe('resolveAgentReportedPath on Windows', () => {
  it('maps a /tmp path back into the temp directory repo', () => {
    const reported = `${msysTempForm(repoPath)}/E2E Plan.md`;

    expect(resolveAgentReportedPath(reported, repoPath, windows)).toBe(
      path.win32.join(repoPath, 'E2E Plan.md')
    );
  });

  it('resolves the reported repo root to the session cwd itself', () => {
    expect(resolveAgentReportedPath(msysTempForm(repoPath), repoPath, windows)).toBe(
      path.win32.normalize(repoPath)
    );
  });

  it('translates the MSYS drive form outside the session cwd', () => {
    expect(resolveAgentReportedPath('/d/code/app/notes.md', 'C:\\repo', windows)).toBe(
      'D:\\code\\app\\notes.md'
    );
  });

  it('translates the cygdrive form', () => {
    expect(resolveAgentReportedPath('/cygdrive/e/data/report.md', 'C:\\repo', windows)).toBe(
      'E:\\data\\report.md'
    );
  });

  it('translates a bare /tmp path with no session cwd', () => {
    expect(resolveAgentReportedPath('/tmp/scratch/a.md', null, windows)).toBe(
      path.win32.join(tempDir, 'scratch', 'a.md')
    );
  });

  it('leaves a Windows path untouched apart from normalization', () => {
    expect(resolveAgentReportedPath('C:\\repo\\src\\..\\notes.md', 'C:\\repo', windows)).toBe(
      'C:\\repo\\notes.md'
    );
  });

  it('keeps a UNC path intact', () => {
    expect(resolveAgentReportedPath('\\\\server\\share\\notes.md', 'C:\\repo', windows)).toBe(
      '\\\\server\\share\\notes.md'
    );
  });

  it('anchors a relative path on the session cwd', () => {
    expect(resolveAgentReportedPath('docs/notes.md', 'C:\\repo', windows)).toBe(
      'C:\\repo\\docs\\notes.md'
    );
  });

  it('resolves an unmapped POSIX root against the session drive, matching Node', () => {
    expect(resolveAgentReportedPath('/usr/share/notes.md', 'D:\\repo', windows)).toBe(
      'D:\\usr\\share\\notes.md'
    );
  });

  it('maps a temp path outside the session cwd through the /tmp mount', () => {
    const sibling = `/tmp/other-repo/notes.md`;

    expect(resolveAgentReportedPath(sibling, repoPath, windows)).toBe(
      path.win32.join(tempDir, 'other-repo', 'notes.md')
    );
  });

  it('accepts the uppercase drive form', () => {
    expect(resolveAgentReportedPath('/C/code/app/notes.md', 'D:\\repo', windows)).toBe(
      'C:\\code\\app\\notes.md'
    );
  });

  it('translates against a session cwd that carries a trailing separator', () => {
    expect(resolveAgentReportedPath('/c/repo/notes.md', 'C:\\repo\\', windows)).toBe(
      'C:\\repo\\notes.md'
    );
  });

  it('normalizes a Windows path written with forward slashes', () => {
    expect(resolveAgentReportedPath('C:/repo/docs/notes.md', 'C:\\repo', windows)).toBe(
      'C:\\repo\\docs\\notes.md'
    );
  });

  // The ACP file handlers translate before writing and the event bridge
  // translates the same path again on ingestion, so translating twice has to
  // land on the same file.
  it('is unchanged by a second translation', () => {
    const once = resolveAgentReportedPath(`${msysTempForm(repoPath)}/notes.md`, repoPath, windows);

    expect(resolveAgentReportedPath(once, repoPath, windows)).toBe(once);
  });

  it('returns an empty reported path untouched', () => {
    expect(resolveAgentReportedPath('', repoPath, windows)).toBe('');
  });
});

describe('resolveAgentReportedPath off Windows', () => {
  it('leaves an absolute POSIX path alone', () => {
    expect(resolveAgentReportedPath('/home/dev/repo/notes.md', '/home/dev/repo', posix)).toBe(
      '/home/dev/repo/notes.md'
    );
  });

  it('anchors a relative path on the session cwd', () => {
    expect(resolveAgentReportedPath('docs/notes.md', '/home/dev/repo', posix)).toBe(
      '/home/dev/repo/docs/notes.md'
    );
  });
});
