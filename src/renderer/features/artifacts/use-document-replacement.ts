import type { Editor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import type { DocumentReplacement } from './use-artifact-restore';

/**
 * Applies a restore to the live document (S7), once per replacement. The host
 * passes a replacement only once this editor has reported the document's true
 * state (`onDocumentReady`); before that, the collab server's copy could still
 * arrive on top of the change. The content goes in through the editor, so the
 * collab binding carries it to every peer, and `onReplaced` gets the document
 * as it now reads.
 */
export function useDocumentReplacement(
  editor: Editor | null,
  replacement: DocumentReplacement | null | undefined,
  onReplaced: ((html: string) => void) | undefined
): void {
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed || !replacement) return;
    if (applied.current === replacement.key) return;
    applied.current = replacement.key;
    editor.commands.setContent(replacement.html);
    onReplaced?.(editor.getHTML());
  }, [editor, replacement, onReplaced]);
}
