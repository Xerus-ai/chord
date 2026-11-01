import type { Editor } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

/** The plain controls of the selection toolbar: marks, alignment, links. */

export function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-border-strong" />;
}

export function AskAgentButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title="Ask agent"
      className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-action-bg/12 px-2.5 text-tiny tracking-tiny font-semibold text-text transition-[filter,background-color] hover:bg-action-bg/20 active:scale-95"
    >
      <Sparkles className="h-3.5 w-3.5" />
      Ask agent
    </button>
  );
}

interface MarkButtonProps {
  editor: Editor;
  mark: string;
  title: string;
  children: React.ReactNode;
}

export function MarkButton({ editor, mark, title, children }: MarkButtonProps) {
  const isActive = editor.isActive(mark);

  const toggle = useCallback(() => {
    const chain = editor.chain().focus();
    switch (mark) {
      case 'bold':
        chain.toggleBold().run();
        break;
      case 'italic':
        chain.toggleItalic().run();
        break;
      case 'underline':
        chain.toggleUnderline().run();
        break;
      case 'strike':
        chain.toggleStrike().run();
        break;
      case 'code':
        chain.toggleCode().run();
        break;
    }
  }, [editor, mark]);

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      title={title}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 transition-colors active:scale-95 ${
        isActive
          ? 'bg-surface-hover-solid text-text'
          : 'text-text-passive hover:bg-surface-hover-solid hover:text-text-muted'
      }`}
    >
      {children}
    </button>
  );
}

export function AlignGroup({ editor }: { editor: Editor }) {
  const options: { value: 'left' | 'center' | 'right'; title: string; Icon: typeof AlignLeft }[] = [
    { value: 'left', title: 'Align left', Icon: AlignLeft },
    { value: 'center', title: 'Align center', Icon: AlignCenter },
    { value: 'right', title: 'Align right', Icon: AlignRight },
  ];
  return (
    <>
      {options.map(({ value, title, Icon: AlignIcon }) => {
        const active = editor.isActive({ textAlign: value });
        return (
          <button
            key={value}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().setTextAlign(value).run()}
            title={title}
            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 transition-colors active:scale-95 ${
              active
                ? 'bg-surface-hover-solid text-text'
                : 'text-text-passive hover:bg-surface-hover-solid hover:text-text-muted'
            }`}
          >
            <AlignIcon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </>
  );
}

export function LinkButton({ editor }: { editor: Editor }) {
  const [showInput, setShowInput] = useState(false);
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isActive = editor.isActive('link');

  useEffect(() => {
    if (showInput) {
      inputRef.current?.focus();
    }
  }, [showInput]);

  const handleClick = useCallback(() => {
    if (isActive) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const existing = editor.getAttributes('link').href;
    setUrl(existing ?? '');
    setShowInput(true);
  }, [editor, isActive]);

  const applyLink = useCallback(() => {
    if (url.trim()) {
      editor.chain().focus().setLink({ href: url.trim() }).run();
    }
    setShowInput(false);
    setUrl('');
  }, [editor, url]);

  if (showInput) {
    return (
      <input
        ref={inputRef}
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            applyLink();
          }
          if (e.key === 'Escape') {
            setShowInput(false);
            setUrl('');
          }
        }}
        onBlur={applyLink}
        placeholder="Paste link…"
        className="h-7 w-44 rounded-md border border-border-strong bg-surface px-2 text-tiny tracking-tiny text-text outline-none placeholder:text-text-passive focus:border-action-bg"
      />
    );
  }

  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
      title="Link"
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 transition-colors active:scale-95 ${
        isActive
          ? 'bg-surface-hover-solid text-text'
          : 'text-text-passive hover:bg-surface-hover-solid hover:text-text-muted'
      }`}
    >
      <Icon>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </Icon>
    </button>
  );
}
