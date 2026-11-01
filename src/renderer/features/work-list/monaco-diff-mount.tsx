import type * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/lib/monaco/editorConfig';
import { getMonacoTheme } from '@renderer/lib/monaco/monaco-themes';
import { useMonaco } from '@renderer/lib/monaco/use-monaco';

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'shell',
    sql: 'sql',
    xml: 'xml',
    svg: 'xml',
  };
  return map[ext] ?? 'plaintext';
}

/**
 * Bare read-only Monaco diff editor mount, shared by the owner DiffViewer and
 * the participant diff viewer. Chrome (headers, actions) stays with each
 * caller — their capabilities differ (the participant has no stage/restore).
 */
export function MonacoDiffMount({
  original,
  modified,
  language,
  renderSideBySide,
  hideUnchangedRegions = false,
}: {
  original: string;
  modified: string;
  language: string;
  renderSideBySide: boolean;
  /** Collapses unchanged spans — the read-only participant view wants the delta, not the file. */
  hideUnchangedRegions?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const { effectiveTheme } = useTheme();
  const m = useMonaco();

  useEffect(() => {
    if (!m || !mountRef.current) return;

    const editor = m.editor.createDiffEditor(mountRef.current, {
      ...DIFF_EDITOR_BASE_OPTIONS,
      readOnly: true,
      renderSideBySide,
      hideUnchangedRegions: { enabled: hideUnchangedRegions },
      theme: getMonacoTheme(effectiveTheme),
    });
    editorRef.current = editor;

    return () => {
      const model = editor.getModel();
      editor.dispose();
      model?.original.dispose();
      model?.modified.dispose();
      editorRef.current = null;
    };
    // Created once Monaco is in; option changes after that go through updateOptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide });
  }, [renderSideBySide]);

  // Mount-time options are a snapshot: without this the setting only takes
  // effect on the next diff that happens to open.
  useEffect(() => {
    editorRef.current?.updateOptions({ hideUnchangedRegions: { enabled: hideUnchangedRegions } });
  }, [hideUnchangedRegions]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !m) return;

    const prev = editor.getModel();
    if (prev) {
      editor.setModel(null);
      prev.original.dispose();
      prev.modified.dispose();
    }

    const originalModel = m.editor.createModel(original, language);
    const modifiedModel = m.editor.createModel(modified, language);
    editor.setModel({ original: originalModel, modified: modifiedModel });
  }, [original, modified, language, m]);

  useEffect(() => {
    if (m) m.editor.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme, m]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !m) return;

    let addColl: monaco.editor.IEditorDecorationsCollection | null = null;
    let delColl: monaco.editor.IEditorDecorationsCollection | null = null;

    const applyGlyphs = () => {
      const changes = editor.getLineChanges();
      if (!changes) return;

      const addDecos: monaco.editor.IModelDeltaDecoration[] = [];
      const delDecos: monaco.editor.IModelDeltaDecoration[] = [];

      for (const c of changes) {
        if (c.modifiedEndLineNumber > 0) {
          for (let ln = c.modifiedStartLineNumber; ln <= c.modifiedEndLineNumber; ln++) {
            addDecos.push({
              range: new m.Range(ln, 1, ln, 1),
              options: { glyphMarginClassName: 'diff-glyph-added' },
            });
          }
        }
        if (c.originalEndLineNumber > 0) {
          for (let ln = c.originalStartLineNumber; ln <= c.originalEndLineNumber; ln++) {
            delDecos.push({
              range: new m.Range(ln, 1, ln, 1),
              options: { glyphMarginClassName: 'diff-glyph-deleted' },
            });
          }
        }
      }

      addColl?.clear();
      delColl?.clear();
      addColl = editor.getModifiedEditor().createDecorationsCollection(addDecos);
      delColl = editor.getOriginalEditor().createDecorationsCollection(delDecos);
    };

    const disposable = editor.onDidUpdateDiff(applyGlyphs);
    applyGlyphs();

    return () => {
      disposable.dispose();
      addColl?.clear();
      delColl?.clear();
    };
  }, [m]);

  return <div ref={mountRef} className="h-full w-full" />;
}
