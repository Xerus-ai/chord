import {
  useCallback,
  useMemo,
  useRef,
  type ChangeEventHandler,
  type KeyboardEventHandler,
  type RefObject,
} from 'react';
import { findMentions, type RoutableParticipant } from './chat-routing';
import { useRetainedPanelActive, useRetainedPanelFocused } from './retained-panel';

/**
 * Everything that decides where a glyph lands. The backdrop and the textarea
 * must both carry it, character for character, or the highlight drifts off the
 * words it is supposed to be under — which is why this is one constant read by
 * both layers rather than two class lists that have to be kept in step.
 */
// `text-content` is the reading tier (design.md §3): the composer input is
// primary content, like the message bodies it produces — not chrome.
//
// `font-sans` is explicit rather than inherited. Monaco scopes its own UI font
// to `.monaco-editor`, so a bare textarea does inherit the app stack today;
// naming it here means a future editor or terminal widening that scope cannot
// silently retypeface the composer.
// The composer card owns the padding (16px all round), so the text layer
// carries none of its own.
const TEXT_METRICS = 'block w-full p-0 font-sans text-content tracking-body';

interface DraftRun {
  text: string;
  mention: boolean;
}

/** The draft cut into plain runs and mention runs, in order. */
function splitDraft(value: string, participants: readonly RoutableParticipant[]): DraftRun[] {
  const spans = findMentions(value, participants);
  if (spans.length === 0) return [{ text: value, mention: false }];

  const runs: DraftRun[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) runs.push({ text: value.slice(cursor, span.start), mention: false });
    runs.push({ text: span.text, mention: true });
    cursor = span.end;
  }
  if (cursor < value.length) runs.push({ text: value.slice(cursor), mention: false });
  return runs;
}

/**
 * A composer textarea that shows its recognised mentions highlighted as they
 * are typed.
 *
 * The textarea stays a real `<textarea>` — contenteditable would take the
 * composer's undo stack, IME handling and auto-grow with it. Instead its text
 * is made transparent and an identically-laid-out backdrop behind it renders
 * the same string with the mention runs tinted. The backdrop takes no pointer
 * events and never affects layout, so caret, selection and auto-grow behave
 * exactly as they did before.
 *
 * Both composers use this, which is what keeps the two boxes visually and
 * behaviourally the same control.
 */
export function MentionHighlightTextarea({
  textareaRef,
  value,
  participants,
  placeholder,
  disabled = false,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  /**
   * Marks this as the target of the `chord:focus-chat` shortcut — only while
   * its tab is the visible one in the focused pane, so hidden composers never are.
   */
  isFocusTarget = false,
}: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  participants: readonly RoutableParticipant[];
  placeholder?: string;
  disabled?: boolean;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  isFocusTarget?: boolean;
}) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const runs = useMemo(() => splitDraft(value, participants), [value, participants]);
  const metrics = TEXT_METRICS;
  const panelActive = useRetainedPanelActive();
  const panelFocused = useRetainedPanelFocused();
  const marked = isFocusTarget && panelActive && panelFocused;

  // Past the auto-grow ceiling the textarea scrolls inside itself; the
  // backdrop has to scroll with it or the highlights stay behind.
  const syncScroll = useCallback(() => {
    const backdrop = backdropRef.current;
    const textarea = textareaRef.current;
    if (backdrop && textarea) backdrop.scrollTop = textarea.scrollTop;
  }, [textareaRef]);

  return (
    <div className={`relative${disabled ? ' opacity-60' : ''}`}>
      <div
        ref={backdropRef}
        aria-hidden="true"
        className={`${metrics} pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words text-text`}
      >
        {runs.map((run, i) =>
          run.mention ? (
            <span key={i} className="composer-mention">
              {run.text}
            </span>
          ) : (
            run.text
          )
        )}
      </div>
      <textarea
        ref={textareaRef}
        data-chord-composer={marked ? '' : undefined}
        className={`${metrics} relative resize-none border-none bg-transparent text-transparent caret-text outline-none placeholder:font-normal placeholder:text-text-passive disabled:cursor-default`}
        placeholder={placeholder}
        rows={1}
        value={value}
        disabled={disabled}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        onScroll={syncScroll}
      />
    </div>
  );
}
