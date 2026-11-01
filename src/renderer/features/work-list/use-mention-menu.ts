import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { activeMentionAt, type ActiveMention } from './chat-mentions';
import type { MentionKind, MentionOption } from './mention-menu';

/**
 * Caret-token mention state for a composer textarea: which token the caret is
 * in, and how picking an option splices back into the draft.
 *
 * The splice arithmetic (which is where an off-by-one silently eats a
 * character) lives here, apart from the composer. `kinds` limits the triggers
 * to the menus the viewer can open (`mentionKindsFor`).
 */
export function useMentionMenu({
  value,
  onValueChange,
  inputRef,
  kinds,
}: {
  value: string;
  onValueChange: (next: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  kinds: ReadonlySet<MentionKind>;
}) {
  const [mention, setMention] = useState<ActiveMention | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // Placed as the spliced draft commits, before the next keystroke can run.
  // A caret set a frame later (requestAnimationFrame) landed after whatever
  // was typed in that frame, so the rest of the sentence went in ahead of it:
  // "@Hey Headth can you review" arrived as "@Hey Headth review … can you".
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    const input = inputRef.current;
    if (caret === null || !input) return;
    pendingCaret.current = null;
    input.setSelectionRange(caret, caret);
  }, [value, inputRef]);

  /** Re-reads the active token after any edit or caret move. */
  const syncMention = useCallback(
    (next: string, caret: number) => {
      setMention(activeMentionAt(next, caret, kinds));
    },
    [kinds]
  );

  const closeMention = useCallback(() => setMention(null), []);

  /** Opens a menu the user asked for by click rather than by typing. */
  const openMention = useCallback((active: ActiveMention) => setMention(active), []);

  const selectMention = useCallback(
    (option: MentionOption) => {
      if (!mention) return;
      const caret = inputRef.current?.selectionStart ?? value.length;
      pendingCaret.current = mention.start + option.insert.length + 1;
      onValueChange(`${value.slice(0, mention.start)}${option.insert} ${value.slice(caret)}`);
      setMention(null);
      inputRef.current?.focus();
    },
    [mention, value, onValueChange, inputRef]
  );

  return { mention, syncMention, closeMention, openMention, selectMention };
}
