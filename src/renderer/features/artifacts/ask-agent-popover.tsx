import type { Editor } from '@tiptap/react';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface AskAgentPopoverProps {
  editor: Editor;
  onSubmit: (data: { selection: string; instruction: string }) => void;
  onCancel?: () => void;
}

const QUICK_ACTIONS: { label: string; instruction: string }[] = [
  { label: 'Improve', instruction: 'Improve this text — make it clearer and more concise.' },
  { label: 'Fix grammar', instruction: 'Fix any spelling and grammar mistakes in this text.' },
  { label: 'Summarize', instruction: 'Summarize this text.' },
  { label: 'Explain', instruction: 'Explain what this text means.' },
];

/** The popover over a document selection. */
export function AskAgentPopover({ editor, onSubmit, onCancel }: AskAgentPopoverProps) {
  const { from, to, empty } = editor.state.selection;
  const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, ' ');

  if (empty || !selectedText) return null;

  const domRect = editor.view.coordsAtPos(from);
  const editorRect = editor.view.dom.closest('.artifact-editor')?.getBoundingClientRect();
  if (!editorRect) return null;

  const top = domRect.top - editorRect.top + 28;
  const left = Math.min(domRect.left - editorRect.left, editorRect.width - 340);

  return (
    <AskAgentCard
      reference={selectedText}
      quickActions
      style={{ top, left }}
      onAsk={(instruction) => onSubmit({ selection: selectedText, instruction })}
      onCancel={onCancel}
    />
  );
}

interface AskAgentCardProps {
  /** What the request is about, shown quoted: selected text, or a picked element. */
  reference: string;
  /** The text quick actions (Improve, Fix grammar…) apply to prose, not to page elements. */
  quickActions?: boolean;
  /** Absolute position inside the host's positioned container. */
  style: CSSProperties;
  /** Present when the viewer can have the agent act on the reference. */
  onAsk?: (instruction: string) => void;
  /** Present when the reference can carry a comment thread; commenting is then the main action. */
  onComment?: (body: string) => void;
  onCancel?: () => void;
}

/**
 * The card over a document selection or a picked page element (plan
 * 2026-09-23 P1b step 3; shared-items step 1, S6): the quoted reference and
 * one text box. On a page it comments first, with Ask agent beside it for a
 * viewer who can edit; over a document selection it asks the agent.
 */
export function AskAgentCard({
  reference,
  quickActions = false,
  style,
  onAsk,
  onComment,
  onCancel,
}: AskAgentCardProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const ask = (instruction: string) => {
    if (!onAsk || !instruction.trim()) return;
    onAsk(instruction.trim());
    setText('');
  };

  const comment = () => {
    if (!onComment || !text.trim()) return;
    onComment(text.trim());
    setText('');
  };

  const submit = () => (onComment ? comment() : ask(text));
  const placeholder = !onComment
    ? 'Ask the agent to…'
    : onAsk
      ? 'Add a comment, or ask the agent…'
      : 'Add a comment…';

  return (
    <div
      className="absolute z-40 w-80 rounded-xl border border-border-strong bg-surface-inset p-2 shadow-2xl"
      style={style}
      data-testid="ask-agent-card"
    >
      <div className="mb-2 flex items-center gap-1 px-0.5 text-tiny tracking-tiny font-semibold text-text">
        {onComment ? <MessageSquare className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
        {onComment ? 'Comment' : 'Ask agent'}
      </div>

      <div className="mb-2 rounded-md border border-border bg-surface-raised px-2 py-2 text-tiny tracking-tiny leading-[1.4] text-text-passive">
        <span className="text-text-passive">Referenced: </span>&ldquo;
        {reference.length > 100 ? `${reference.slice(0, 100)}…` : reference}&rdquo;
      </div>

      {quickActions && onAsk && (
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ask(action.instruction)}
              className="rounded-md border border-border bg-surface-raised px-2 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text active:scale-95"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') onCancel?.();
        }}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none rounded-md border border-border bg-surface-raised px-2 py-2 text-body tracking-body text-text outline-none transition-colors placeholder:text-text-passive focus:border-action-bg"
      />

      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onCancel?.()}
          className="rounded-md px-2 py-1 text-tiny tracking-tiny font-medium text-text-passive transition-colors hover:text-text-muted"
        >
          Cancel
        </button>
        {onComment && onAsk && (
          <button
            type="button"
            onClick={() => ask(text)}
            disabled={!text.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1 text-tiny tracking-tiny font-semibold text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:text-text-disabled"
          >
            <Sparkles className="h-3 w-3" />
            Ask agent
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-md bg-action-bg px-3 py-1 text-tiny tracking-tiny font-semibold text-action-fg transition-[filter] hover:brightness-105 disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
        >
          {onComment ? 'Comment' : 'Send'}
        </button>
      </div>
    </div>
  );
}
