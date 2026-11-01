import {
  CHORD_ID_ATTRIBUTE,
  isChordId,
  MAX_EDIT_TEXT_LENGTH,
} from '@shared/artifact-frame-constants';
import type { FrameToHostMessage } from '@shared/artifact-frame-messages';
import {
  isRuntimeChrome,
  mountRuntimeOverlay,
  mountRuntimeStyle,
  RUNTIME_CHROME_ID_PREFIX,
} from './page-runtime-chrome';

const EDITABLE_ATTRIBUTE = 'data-chord-editable';
const EDITING_ATTRIBUTE = 'data-chord-editing';
const HINT_TEXT = "This text can't be edited here. Comment on it to ask the agent.";
const HINT_VISIBLE_MS = 2500;

const EDITING_CSS = `
[${EDITABLE_ATTRIBUTE}]:hover { outline: 1px dashed var(--border-strong); outline-offset: 2px; }
[${EDITING_ATTRIBUTE}], [${EDITING_ATTRIBUTE}]:hover { outline: 2px solid var(--focus-ring); outline-offset: 2px; cursor: text; }
#${RUNTIME_CHROME_ID_PREFIX}edit-hint {
  position: fixed; z-index: 2147483647; pointer-events: none; display: none;
  padding: 4px 8px; border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--surface-raised); color: var(--text-muted); box-shadow: var(--shadow-sm);
  font: 12px/1.4 var(--font-sans); white-space: nowrap;
}
`;

function isTextNode(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE;
}

/**
 * An element the frame may edit: one the host listed as text in the source
 * (main's `isTextElement`, read by editable-text-ids.ts), which still holds
 * only text here. The list matters because every pickable element is
 * stamped: a stamped element a script filled in reads as text in the page
 * but not in the source, and main would refuse its edit. Main re-checks
 * every edit against the source on commit.
 */
function isEditableTextElement(
  element: Element,
  editableIds: ReadonlySet<string>
): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const chordId = element.getAttribute(CHORD_ID_ATTRIBUTE);
  if (!isChordId(chordId) || !editableIds.has(chordId)) return false;
  const nodes = [...element.childNodes];
  if (nodes.length === 0 || !nodes.every(isTextNode)) return false;
  return nodes.some((node) => (node.textContent ?? '').trim() !== '');
}

/** Copy the user can see but not edit here: text built by a script, or mixed markup. */
function hasOwnCopy(element: Element): boolean {
  return [...element.childNodes].some(
    (node) => isTextNode(node) && (node.textContent ?? '').trim() !== ''
  );
}

/**
 * Edit in place (plan 2026-09-23 P1b step 2; double-click since shared-items
 * step 1, S6). This is the default mode of an owner's web page, so a single
 * click still reaches the page — a prototype's button presses, a link
 * follows. A double-click on a stamped text element makes that one element
 * editable, `plaintext-only` so no markup can be typed or pasted in, and never
 * `designMode`, which would let a user break layout and scripts. It commits
 * on blur or Enter as `{ chordId, originalText, text }`; Escape puts the text
 * back. A double-click on copy that cannot be edited here says where to take
 * it instead.
 */
export function createTextEditing(post: (message: FrameToHostMessage) => void) {
  let editableIds: ReadonlySet<string> = new Set();
  let candidates: HTMLElement[] = [];
  let style: HTMLStyleElement | null = null;
  let hint: HTMLDivElement | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let editing: { element: HTMLElement; original: string } | null = null;

  function commit(element: HTMLElement, original: string): void {
    const text = element.textContent ?? '';
    if (text === original) return;
    const chordId = element.getAttribute(CHORD_ID_ATTRIBUTE);
    if (!isChordId(chordId)) return;
    if (text.length > MAX_EDIT_TEXT_LENGTH || original.length > MAX_EDIT_TEXT_LENGTH) {
      element.textContent = original;
      post({
        type: 'chord:error',
        message: `Edited text is longer than ${MAX_EDIT_TEXT_LENGTH} characters and was not saved.`,
      });
      return;
    }
    post({ type: 'chord:text-edit', chordId, originalText: original, text });
  }

  /** Ends the edit in progress, committing it unless it was cancelled. */
  function finish({ cancel }: { cancel: boolean }): void {
    if (!editing) return;
    const { element, original } = editing;
    editing = null;
    element.removeAttribute('contenteditable');
    element.removeAttribute(EDITING_ATTRIBUTE);
    if (cancel) element.textContent = original;
    else commit(element, original);
    element.blur();
  }

  function begin(element: HTMLElement): void {
    if (editing?.element === element) return;
    finish({ cancel: false });
    editing = { element, original: element.textContent ?? '' };
    element.setAttribute('contenteditable', 'plaintext-only');
    element.setAttribute(EDITING_ATTRIBUTE, '');
    element.focus();
  }

  function showHint(target: Element): void {
    if (!hint) return;
    const rect = target.getBoundingClientRect();
    hint.style.left = `${Math.max(4, rect.left)}px`;
    hint.style.top = `${Math.max(4, rect.top - 30)}px`;
    hint.style.display = 'block';
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      if (hint) hint.style.display = 'none';
    }, HINT_VISIBLE_MS);
  }

  function isInsideEdit(target: EventTarget | null): boolean {
    return !!editing && target instanceof Node && editing.element.contains(target);
  }

  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || isRuntimeChrome(target)) return;
    const stamped = target.closest(`[${CHORD_ID_ATTRIBUTE}]`);
    if (stamped && isEditableTextElement(stamped, editableIds)) begin(stamped);
    else if (hasOwnCopy(target)) showHint(target);
  };

  const onFocusOut = (event: FocusEvent) => {
    if (editing && event.target === editing.element) finish({ cancel: false });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isInsideEdit(event.target)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      finish({ cancel: false });
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finish({ cancel: true });
    }
  };

  // A click inside the text being edited places the caret; it must not also
  // press the button or follow the link the text sits in.
  const onClick = (event: MouseEvent) => {
    if (!isInsideEdit(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  function markCandidates(): void {
    for (const element of candidates) element.removeAttribute(EDITABLE_ATTRIBUTE);
    candidates = [...document.querySelectorAll(`[${CHORD_ID_ATTRIBUTE}]`)].filter(
      (element): element is HTMLElement => isEditableTextElement(element, editableIds)
    );
    for (const element of candidates) element.setAttribute(EDITABLE_ATTRIBUTE, '');
  }

  /** Turns editing on, or updates which elements edit when it is already on. */
  function enable(ids: readonly string[]): void {
    editableIds = new Set(ids);
    if (style) {
      markCandidates();
      return;
    }
    style = mountRuntimeStyle('edit', EDITING_CSS);
    hint = mountRuntimeOverlay('edit-hint');
    hint.textContent = HINT_TEXT;
    markCandidates();
    document.addEventListener('dblclick', onDoubleClick, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);
  }

  function disable(): void {
    if (!style) return;
    // Leaving edit mode commits whatever is being typed, as a blur would.
    finish({ cancel: false });
    for (const element of candidates) element.removeAttribute(EDITABLE_ATTRIBUTE);
    candidates = [];
    editableIds = new Set();
    document.removeEventListener('dblclick', onDoubleClick, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onClick, true);
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    style.remove();
    style = null;
    hint?.remove();
    hint = null;
  }

  return { enable, disable };
}
