import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';
import { useEffect, useRef } from 'react';
import type { DocumentCommentAnchor } from './comment-numbering';
import { locateCommentAnchor } from './document-comment-anchors';

/** The numbered comments a document shows, and what a click on one does. */
export interface DocumentCommentBadges {
  anchors: DocumentCommentAnchor[];
  selected: number | null;
  onSelect: (n: number) => void;
}

interface BadgeState {
  anchors: DocumentCommentAnchor[];
  selected: number | null;
  decorations: DecorationSet;
}

type BadgeUpdate = Pick<BadgeState, 'anchors' | 'selected'>;

const badgesKey = new PluginKey<BadgeState>('chordCommentBadges');
const BADGE_ATTRIBUTE = 'data-comment-badge';

function createBadge(n: number, selected: boolean): HTMLElement {
  const badge = document.createElement('span');
  badge.className = selected ? 'chord-comment-badge is-selected' : 'chord-comment-badge';
  badge.setAttribute(BADGE_ATTRIBUTE, String(n));
  badge.setAttribute('contenteditable', 'false');
  badge.title = `Comment ${n}`;
  badge.textContent = String(n);
  return badge;
}

/**
 * The quoted text of each comment is highlighted, with the thread's number as
 * a badge where the quote starts. A comment whose quote is no longer in the
 * document draws nothing here; the card still lists it.
 */
function decorate(doc: ProseMirrorNode, { anchors, selected }: BadgeUpdate): DecorationSet {
  const decorations: Decoration[] = [];
  for (const anchor of anchors) {
    const range = locateCommentAnchor(doc, anchor.text, anchor.pos);
    if (!range) continue;
    const isSelected = anchor.n === selected;
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: isSelected ? 'chord-comment-anchor is-selected' : 'chord-comment-anchor',
      }),
      Decoration.widget(range.from, () => createBadge(anchor.n, isSelected), {
        side: -1,
        ignoreSelection: true,
        key: `comment-badge-${anchor.n}-${isSelected ? 'on' : 'off'}`,
      })
    );
  }
  return DecorationSet.create(doc, decorations);
}

function createBadgesPlugin(onSelect: (n: number) => void): Plugin<BadgeState> {
  return new Plugin<BadgeState>({
    key: badgesKey,
    state: {
      init: () => ({ anchors: [], selected: null, decorations: DecorationSet.empty }),
      apply(tr, value, _oldState, newState) {
        const update = tr.getMeta(badgesKey) as BadgeUpdate | undefined;
        if (update) return { ...update, decorations: decorate(newState.doc, update) };
        if (!tr.docChanged) return value;
        return { ...value, decorations: decorate(newState.doc, value) };
      },
    },
    props: {
      decorations: (state) => badgesKey.getState(state)?.decorations,
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const badge =
            event.target instanceof Element ? event.target.closest(`[${BADGE_ATTRIBUTE}]`) : null;
          if (!badge) return false;
          event.preventDefault();
          onSelect(Number(badge.getAttribute(BADGE_ATTRIBUTE)));
          return true;
        },
      },
    },
  });
}

/**
 * Draws a document's numbered comments (shared-items step 1, S6). The plugin
 * is registered on the live editor, like the collab cursor plugin, so the
 * editor is not rebuilt; each change of comments or selection is a
 * metadata-only transaction. Selecting a thread scrolls its badge into view.
 */
export function useDocumentCommentBadges(
  editor: Editor | null,
  badges: DocumentCommentBadges | undefined
): void {
  const onSelectRef = useRef(badges?.onSelect);
  useEffect(() => {
    onSelectRef.current = badges?.onSelect;
  }, [badges?.onSelect]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.registerPlugin(createBadgesPlugin((n) => onSelectRef.current?.(n)));
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(badgesKey);
    };
  }, [editor]);

  const anchors = badges?.anchors;
  const selected = badges?.selected ?? null;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const update: BadgeUpdate = { anchors: anchors ?? [], selected };
    editor.view.dispatch(editor.state.tr.setMeta(badgesKey, update));
  }, [editor, anchors, selected]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || selected === null) return;
    editor.view.dom
      .querySelector(`[${BADGE_ATTRIBUTE}="${selected}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [editor, selected]);
}
