import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentWriteRecorder } from './record-document-writes';

// A real absolute root on every platform: on Windows `join('/work', 'repo')`
// is drive-less (`\work\repo`), a form no session workspace ever has.
const ROOT = join(tmpdir(), 'chord-recorder');
const CWD = join(ROOT, 'repo');

function recorderFor(cwd: string = CWD): DocumentWriteRecorder {
  const recorder = new DocumentWriteRecorder();
  recorder.setWorkspaceDir(cwd);
  return recorder;
}

describe('DocumentWriteRecorder', () => {
  it('reports a document written this turn and not published', () => {
    const recorder = recorderFor();
    recorder.recordWrite(join(CWD, 'notes.md'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([join(CWD, 'notes.md')]);
  });

  it('leaves out a document the agent published in the same turn', () => {
    const recorder = recorderFor();
    recorder.recordWrite(join(CWD, 'plan.md'));
    recorder.recordWrite(join(CWD, 'notes.md'));
    recorder.markPublished(join(CWD, 'plan.md'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([join(CWD, 'notes.md')]);
  });

  it('leaves out a document that is already an artifact of the work item', () => {
    const recorder = recorderFor();
    recorder.recordWrite(join(CWD, 'plan.md'));
    expect(recorder.takeUnpublishedDocuments(new Set([join(CWD, 'plan.md')]))).toEqual([]);
  });

  it('records documents only — code and assets are the Changes tab', () => {
    const recorder = recorderFor();
    recorder.recordWrite(join(CWD, 'src', 'index.ts'));
    recorder.recordWrite(join(CWD, 'site', 'index.html'));
    recorder.recordWrite(join(CWD, 'brief.docx'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([join(CWD, 'brief.docx')]);
  });

  it('ignores writes outside the workspace and agent machinery inside it', () => {
    const recorder = recorderFor();
    recorder.recordWrite(join(ROOT, 'home', '.claude', 'plans', 'draft.md'));
    recorder.recordWrite(join(CWD, '..', 'sibling.md'));
    recorder.recordWrite(join(CWD, '.claude', 'notes.md'));
    recorder.recordWrite(join(CWD, '.chord', 'plans', 'plan.md'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([]);
  });

  it('resolves relative reports against the workspace and reports each file once', () => {
    const recorder = recorderFor();
    recorder.recordWrite('notes.md');
    recorder.recordWrite(join(CWD, 'notes.md'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([join(CWD, 'notes.md')]);
  });

  it('starts every turn empty', () => {
    const recorder = recorderFor();
    recorder.recordWrite(join(CWD, 'notes.md'));
    recorder.markPublished(join(CWD, 'plan.md'));
    recorder.takeUnpublishedDocuments(new Set());
    recorder.recordWrite(join(CWD, 'plan.md'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([join(CWD, 'plan.md')]);
  });

  it('honours a suppressed plan-mode draft', () => {
    const recorder = recorderFor();
    recorder.suppress(join(CWD, 'draft-plan.md'));
    recorder.recordWrite(join(CWD, 'draft-plan.md'));
    expect(recorder.takeUnpublishedDocuments(new Set())).toEqual([]);
  });
});
