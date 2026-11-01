import type { Editor } from '@tiptap/react';
import { useRef, useState } from 'react';
import { MentionTextarea, type MentionTextareaHandle } from './mention-textarea';

interface FloatingComposerProps {
  editor: Editor;
  workItemId: string;
  onSubmit: (data: {
    body: string;
    anchor_key: string | null;
    anchor_text: string | null;
    mentioned_user_ids: string[];
  }) => void;
  onCancel?: () => void;
}

export function FloatingComposer({
  editor,
  workItemId,
  onSubmit,
  onCancel,
}: FloatingComposerProps) {
  const composerRef = useRef<MentionTextareaHandle>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const { from, to, empty } = editor.state.selection;
  const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, ' ');

  if (empty) return null;

  const domRect = editor.view.coordsAtPos(from);
  const editorRect = editor.view.dom.closest('.artifact-editor')?.getBoundingClientRect();
  if (!editorRect) return null;

  const top = domRect.top - editorRect.top + 28;
  const left = Math.min(domRect.left - editorRect.left, editorRect.width - 320);

  const handleSubmit = (body: string, mentionedUserIds: string[]) => {
    onSubmit({
      body,
      anchor_key: String(from),
      anchor_text: selectedText || null,
      mentioned_user_ids: mentionedUserIds,
    });
  };

  return (
    <div
      className="absolute z-40 w-72 rounded-lg border border-border-strong bg-surface-inset p-3 shadow-lg"
      style={{ top, left }}
    >
      {selectedText && (
        <div className="mb-2.5 rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-tiny tracking-tiny leading-[1.4] text-text-passive">
          <span className="text-text-passive">Referenced:</span> &ldquo;
          {selectedText.length > 100 ? `${selectedText.slice(0, 100)}…` : selectedText}&rdquo;
        </div>
      )}
      <MentionTextarea
        ref={composerRef}
        workItemId={workItemId}
        placeholder="Add a comment…"
        autoFocus
        onSubmit={handleSubmit}
        onCancel={onCancel}
        onEmptyChange={setIsEmpty}
        className="w-full resize-none rounded-md border border-border bg-surface-raised px-2.5 py-2 text-body tracking-body text-text outline-none transition-colors placeholder:text-text-passive focus:border-border-strong"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-tiny tracking-tiny font-medium text-text-passive transition-colors hover:text-text-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => composerRef.current?.submit()}
          disabled={isEmpty}
          className="rounded-md bg-action-bg px-3 py-1 text-tiny tracking-tiny font-semibold text-action-fg transition-[filter] hover:brightness-105 disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
