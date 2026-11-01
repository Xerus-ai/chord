import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { MessageSquare } from 'lucide-react';
import { ColorPopover } from './floating-toolbar-color';
import {
  AlignGroup,
  AskAgentButton,
  Divider,
  Icon,
  LinkButton,
  MarkButton,
} from './floating-toolbar-controls';
import { TurnInto } from './floating-toolbar-turn-into';

interface FloatingToolbarProps {
  editor: Editor;
  /**
   * Whether the document accepts writes. Tiptap still applies programmatic
   * commands to a non-editable view, so a locked document showed a full
   * formatting bar whose buttons silently rewrote it.
   */
  editable: boolean;
  onComment?: () => void;
  onAskAgent?: () => void;
}

export function FloatingToolbar({ editor, editable, onComment, onAskAgent }: FloatingToolbarProps) {
  // Commenting and asking the agent read the selection without changing the
  // document, so they stay available while the document is locked.
  const hasReadOnlyActions = !!onAskAgent || !!onComment;

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      shouldShow={({ editor: e, from, to }) => {
        if (from === to) return false;
        if (e.isActive('codeBlock')) return false;
        if (!editable && !hasReadOnlyActions) return false;
        return true;
      }}
    >
      <div className="flex h-9 items-center gap-1 rounded-xl border border-border-strong bg-surface-inset px-1.5 shadow-2xl">
        {onAskAgent && (
          <>
            <AskAgentButton onClick={onAskAgent} />
            {(editable || onComment) && <Divider />}
          </>
        )}
        {editable && (
          <>
            <TurnInto editor={editor} />
            <Divider />
            <MarkButton editor={editor} mark="bold" title="Bold">
              <span className="text-body tracking-body font-semibold">B</span>
            </MarkButton>
            <MarkButton editor={editor} mark="italic" title="Italic">
              <span className="font-serif text-body tracking-body italic">I</span>
            </MarkButton>
            <MarkButton editor={editor} mark="underline" title="Underline">
              <span className="text-body tracking-body underline">U</span>
            </MarkButton>
            <MarkButton editor={editor} mark="strike" title="Strikethrough">
              <span className="text-body tracking-body line-through">S</span>
            </MarkButton>
            <MarkButton editor={editor} mark="code" title="Inline code">
              <Icon>
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </Icon>
            </MarkButton>
            <Divider />
            <ColorPopover editor={editor} />
            <Divider />
            <AlignGroup editor={editor} />
            <Divider />
            <LinkButton editor={editor} />
          </>
        )}
        {onComment && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onComment}
            title="Comment"
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-text-passive transition-colors hover:bg-surface-hover-solid hover:text-text-muted active:scale-95"
          >
            <MessageSquare className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </BubbleMenu>
  );
}
