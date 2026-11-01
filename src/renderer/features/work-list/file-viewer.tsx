import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { FILE_EDITOR_BASE_OPTIONS } from '@renderer/lib/monaco/editorConfig';
import { getMonacoTheme } from '@renderer/lib/monaco/monaco-themes';
import { useMonaco } from '@renderer/lib/monaco/use-monaco';
import { detectLanguage } from './monaco-diff-mount';

function MonacoFileMount({
  content,
  language,
  revealLine,
  onChange,
  onSave,
}: {
  content: string;
  language: string;
  revealLine?: number;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const handlers = useRef({ onChange, onSave });
  useEffect(() => {
    handlers.current = { onChange, onSave };
  }, [onChange, onSave]);
  const { effectiveTheme } = useTheme();
  const m = useMonaco();

  useEffect(() => {
    if (!m || !mountRef.current) return;

    const editor = m.editor.create(mountRef.current, {
      ...FILE_EDITOR_BASE_OPTIONS,
      readOnly: false,
      theme: getMonacoTheme(effectiveTheme),
    });
    editorRef.current = editor;
    const changes = editor.onDidChangeModelContent(() => {
      handlers.current.onChange(editor.getValue());
    });
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => handlers.current.onSave());

    return () => {
      changes.dispose();
      const model = editor.getModel();
      editor.dispose();
      model?.dispose();
      editorRef.current = null;
    };
    // Created once Monaco is in; the theme follows through setTheme below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m]);

  // The loaded file becomes the model once; later loads (a save's refetch)
  // must not reset what is being typed.
  const loaded = useRef(false);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !m || loaded.current) return;
    loaded.current = true;

    const prev = editor.getModel();
    editor.setModel(m.editor.createModel(content, language));
    prev?.dispose();

    if (revealLine) {
      editor.revealLineInCenter(revealLine);
      editor.setPosition({ lineNumber: revealLine, column: 1 });
    }
  }, [content, language, revealLine, m]);

  useEffect(() => {
    if (m) m.editor.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme, m]);

  return <div ref={mountRef} className="h-full w-full" />;
}

/**
 * A path tab's Edit mode (design 2026-09-26 §3): the file's source in an
 * editable Monaco, saved with ⌘S / Ctrl+S. The first change promotes a preview
 * tab. `worktreeId` picks the checkout; omitted edits the primary worktree.
 */
export function FileViewer({
  workItemId,
  worktreeId,
  filePath,
  line,
  onEdited,
}: {
  workItemId: string;
  worktreeId?: string;
  filePath: string;
  line?: number;
  onEdited: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const { data, isPending, error } = useQuery({
    queryKey: ['workItem', 'fileContent', workItemId, filePath, worktreeId],
    queryFn: async () => {
      const result = await rpc.workItems.readRepoFile(workItemId, filePath, worktreeId);
      if (!result.success) throw new Error(`Failed to read file: ${result.error.type}`);
      return result.data;
    },
  });

  const edited = useRef(false);
  const handleChange = useCallback(
    (value: string) => {
      if (!edited.current) {
        edited.current = true;
        onEdited();
      }
      setDraft(value);
    },
    [onEdited]
  );

  const handleSave = useCallback(() => {
    if (draft === null) return;
    setSaveState({ kind: 'saving' });
    void rpc.workItems.writeRepoFile(workItemId, filePath, draft, worktreeId).then(
      (result) => {
        if (!result.success) {
          setSaveState({ kind: 'error', message: `Could not save: ${result.error.type}` });
          return;
        }
        setSaveState({ kind: 'idle' });
        setDraft(null);
        for (const key of ['fileContent', 'fileDiff']) {
          void queryClient.invalidateQueries({
            queryKey: ['workItem', key, workItemId, filePath, worktreeId],
          });
        }
        void queryClient.invalidateQueries({ queryKey: ['rail', 'git'] });
      },
      (thrown: unknown) => setSaveState({ kind: 'error', message: String(thrown) })
    );
  }, [draft, workItemId, filePath, worktreeId, queryClient]);

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-body tracking-body text-text-passive">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading file…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-body tracking-body text-status-err">
        {String(error instanceof Error ? error.message : error)}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="file-editor">
      {(draft !== null || saveState.kind !== 'idle') && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-4 py-1 text-tiny tracking-tiny">
          {saveState.kind === 'error' ? (
            <span role="alert" className="text-status-err">
              {saveState.message}
            </span>
          ) : saveState.kind === 'saving' ? (
            <span className="text-text-passive">Saving…</span>
          ) : (
            <span className="text-text-muted">Unsaved changes · ⌘S to save</span>
          )}
        </div>
      )}
      <div className="flex-1 overflow-hidden">
        <MonacoFileMount
          content={data.content}
          language={detectLanguage(filePath)}
          revealLine={line}
          onChange={handleChange}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
