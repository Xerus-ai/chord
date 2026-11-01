import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface DragHandleProps {
  editor: Editor;
  onComment?: (nodePos: number) => void;
}

interface HandlePosition {
  top: number;
  left: number;
  nodePos: number;
}

function getBlockTypeName(editor: Editor, nodePos: number): string {
  const node = editor.state.doc.nodeAt(nodePos);
  if (!node) return 'Block';
  if (node.type.name === 'heading') return `Heading ${node.attrs.level}`;
  if (node.type.name === 'bulletList') return 'Bullet List';
  if (node.type.name === 'orderedList') return 'Numbered List';
  if (node.type.name === 'taskList') return 'To-do List';
  if (node.type.name === 'blockquote') return 'Quote';
  if (node.type.name === 'codeBlock') return 'Code';
  if (node.type.name === 'horizontalRule') return 'Divider';
  return 'Paragraph';
}

export function DragHandle({ editor, onComment }: DragHandleProps) {
  const [position, setPosition] = useState<HandlePosition | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showTurnInto, setShowTurnInto] = useState(false);
  const editorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // The editor's own DOM node, never a document-wide lookup: the split pane
    // and the full-screen view can both be mounted, and querying the document
    // bound this handle to whichever editor happened to render first — so it
    // reported hover positions from one document onto the other.
    const editorEl = editor.view.dom as HTMLElement;
    editorRef.current = editorEl;

    const handleMouseMove = (e: Event) => {
      const me = e as MouseEvent;
      if (!editorRef.current) return;

      const pos = editor.view.posAtCoords({
        left: me.clientX,
        top: me.clientY,
      });
      if (!pos) {
        setPosition(null);
        return;
      }

      const resolvedPos = editor.state.doc.resolve(pos.pos);
      const nodePos = resolvedPos.before(1);
      const node = editor.view.nodeDOM(nodePos);
      if (!node || !(node instanceof HTMLElement)) {
        setPosition(null);
        return;
      }

      const editorRect = editorRef.current.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();

      setPosition({
        top: nodeRect.top - editorRect.top,
        left: -48,
        nodePos,
      });
    };

    const handleMouseLeave = () => {
      if (!showMenu) setPosition(null);
    };

    editorEl.addEventListener('mousemove', handleMouseMove);
    editorEl.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      editorEl.removeEventListener('mousemove', handleMouseMove);
      editorEl.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [editor, showMenu]);

  const handleAddBelow = useCallback(() => {
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position.nodePos);
    if (!node) return;
    const endPos = position.nodePos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(endPos, { type: 'paragraph' })
      .setTextSelection(endPos + 1)
      .run();
    setShowMenu(false);
  }, [editor, position]);

  const handleDuplicate = useCallback(() => {
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position.nodePos);
    if (!node) return;
    const endPos = position.nodePos + node.nodeSize;
    editor.chain().focus().insertContentAt(endPos, node.toJSON()).run();
    setShowMenu(false);
  }, [editor, position]);

  const handleDelete = useCallback(() => {
    if (position === null) return;
    const node = editor.state.doc.nodeAt(position.nodePos);
    if (!node) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: position.nodePos, to: position.nodePos + node.nodeSize })
      .run();
    setShowMenu(false);
    setPosition(null);
  }, [editor, position]);

  // ProseMirror only moves content for a drag it started itself, which means
  // its own `dragging` state has to be primed here. Without it the browser ran
  // a drag that nothing consumed, and the block snapped back on drop.
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      if (position === null) return;
      const node = editor.state.doc.nodeAt(position.nodePos);
      if (!node) return;

      editor.commands.setNodeSelection(position.nodePos);
      const view = editor.view;
      const slice = view.state.selection.content();

      e.dataTransfer.clearData();
      // A drag with an empty dataTransfer is cancelled outright by the browser.
      e.dataTransfer.setData(
        'text/plain',
        slice.content.textBetween(0, slice.content.size, '\n', '\n')
      );
      e.dataTransfer.effectAllowed = 'move';

      const nodeDom = view.nodeDOM(position.nodePos);
      if (nodeDom instanceof HTMLElement) {
        e.dataTransfer.setDragImage(nodeDom, 0, 0);
      }

      // eslint-disable-next-line react-hooks/immutability -- EditorView.dragging is ProseMirror's documented drag handoff; it is designed to be written by the code that starts the drag.
      view.dragging = { slice, move: true };
    },
    [editor, position]
  );

  const handleDragEnd = useCallback(() => {
    // eslint-disable-next-line react-hooks/immutability -- clearing the same documented ProseMirror drag handoff set in handleDragStart.
    editor.view.dragging = null;
    setPosition(null);
  }, [editor]);

  const handleComment = useCallback(() => {
    if (position === null) return;
    onComment?.(position.nodePos);
    setShowMenu(false);
  }, [position, onComment]);

  const handleTurnInto = useCallback(
    (type: string, attrs?: Record<string, unknown>) => {
      if (position === null) return;
      const chain = editor.chain().focus();
      editor.commands.setNodeSelection(position.nodePos);

      switch (type) {
        case 'paragraph':
          chain.setParagraph().run();
          break;
        case 'heading':
          chain.toggleHeading({ level: (attrs?.level as 1 | 2 | 3) ?? 1 }).run();
          break;
        case 'bulletList':
          chain.toggleBulletList().run();
          break;
        case 'orderedList':
          chain.toggleOrderedList().run();
          break;
        case 'blockquote':
          chain.toggleBlockquote().run();
          break;
        case 'codeBlock':
          chain.toggleCodeBlock().run();
          break;
      }
      setShowTurnInto(false);
      setShowMenu(false);
    },
    [editor, position]
  );

  if (!position) return null;

  const blockType = getBlockTypeName(editor, position.nodePos);

  return (
    <div
      className="absolute z-10 flex items-center gap-0.5"
      style={{ top: position.top, left: position.left }}
    >
      <button
        type="button"
        onClick={handleAddBelow}
        className="flex h-6 w-5 items-center justify-center rounded text-text-passive transition-colors hover:bg-surface-inset hover:text-text-muted"
        title="Add block below"
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <div className="relative">
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onClick={() => {
            setShowMenu(!showMenu);
            setShowTurnInto(false);
          }}
          className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-text-passive transition-colors hover:bg-surface-inset hover:text-text-muted active:cursor-grabbing"
          title="Drag to move · Click for options"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
            <circle cx="4.5" cy="3" r="1.2" />
            <circle cx="9.5" cy="3" r="1.2" />
            <circle cx="4.5" cy="7" r="1.2" />
            <circle cx="9.5" cy="7" r="1.2" />
            <circle cx="4.5" cy="11" r="1.2" />
            <circle cx="9.5" cy="11" r="1.2" />
          </svg>
        </button>

        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setShowMenu(false);
                setShowTurnInto(false);
              }}
            />
            <div className="absolute left-0 top-7 z-50 w-52 rounded-lg border border-border-strong bg-surface-inset shadow-lg">
              <div className="border-b border-border px-3 py-2 text-tiny tracking-tiny font-medium text-text-passive">
                {blockType}
              </div>
              <div className="p-1">
                <div className="relative">
                  <BlockMenuItem
                    onClick={() => setShowTurnInto(!showTurnInto)}
                    label="Turn into"
                    hasSubmenu
                  >
                    <path d="M17 1l4 4-4 4" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <path d="M7 23l-4-4 4-4" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </BlockMenuItem>
                  {showTurnInto && (
                    <div className="absolute left-full top-0 z-50 ml-1 w-40 rounded-lg border border-border-strong bg-surface-inset p-1 shadow-lg">
                      <TurnIntoItem label="Text" onClick={() => handleTurnInto('paragraph')} />
                      <TurnIntoItem
                        label="Heading 1"
                        onClick={() => handleTurnInto('heading', { level: 1 })}
                      />
                      <TurnIntoItem
                        label="Heading 2"
                        onClick={() => handleTurnInto('heading', { level: 2 })}
                      />
                      <TurnIntoItem
                        label="Heading 3"
                        onClick={() => handleTurnInto('heading', { level: 3 })}
                      />
                      <TurnIntoItem
                        label="Bullet List"
                        onClick={() => handleTurnInto('bulletList')}
                      />
                      <TurnIntoItem
                        label="Numbered List"
                        onClick={() => handleTurnInto('orderedList')}
                      />
                      <TurnIntoItem label="Quote" onClick={() => handleTurnInto('blockquote')} />
                      <TurnIntoItem label="Code" onClick={() => handleTurnInto('codeBlock')} />
                    </div>
                  )}
                </div>
                <BlockMenuItem onClick={handleDuplicate} label="Duplicate" shortcut="Ctrl+D">
                  <rect x="9" y="9" width="11" height="11" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </BlockMenuItem>
                <div className="my-1 h-px bg-border" />
                <BlockMenuItem onClick={handleDelete} label="Delete" shortcut="Del" destructive>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </BlockMenuItem>
                {onComment && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <BlockMenuItem onClick={handleComment} label="Comment" shortcut="Ctrl+⇧+M">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </BlockMenuItem>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function BlockMenuItem({
  onClick,
  label,
  shortcut,
  destructive,
  hasSubmenu,
  children,
}: {
  onClick: () => void;
  label: string;
  shortcut?: string;
  destructive?: boolean;
  hasSubmenu?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-body tracking-body transition-colors ${
        destructive
          ? 'text-status-err hover:bg-status-err-bg'
          : 'text-text-muted hover:bg-surface-hover-solid hover:text-text'
      }`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        {children}
      </svg>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="ml-auto text-tiny tracking-tiny text-text-passive">{shortcut}</span>
      )}
      {hasSubmenu && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="ml-auto text-text-passive"
        >
          <path d="M3.5 2L7 5L3.5 8" />
        </svg>
      )}
    </button>
  );
}

function TurnIntoItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-md px-2 py-2 text-left text-body tracking-body text-text-muted transition-colors hover:bg-surface-hover-solid hover:text-text"
    >
      {label}
    </button>
  );
}
