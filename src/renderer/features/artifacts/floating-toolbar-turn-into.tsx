import type { Editor } from '@tiptap/react';
import { useDropdown } from './use-dropdown';

const TURN_INTO: { label: string; isActive: (e: Editor) => boolean; run: (e: Editor) => void }[] = [
  {
    label: 'Text',
    isActive: (e) => e.isActive('paragraph') && !e.isActive('bulletList'),
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    label: 'Heading 1',
    isActive: (e) => e.isActive('heading', { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2',
    isActive: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: 'Heading 3',
    isActive: (e) => e.isActive('heading', { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: 'Bullet List',
    isActive: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Quote',
    isActive: (e) => e.isActive('blockquote'),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

export function TurnInto({ editor }: { editor: Editor }) {
  const { open, setOpen, ref } = useDropdown();

  const current = TURN_INTO.find((t) => t.isActive(editor)) ?? TURN_INTO[0]!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-hover-solid"
        title="Turn into"
      >
        {current.label}
        <svg width="9" height="9" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-40 rounded-lg border border-border-strong bg-surface-inset p-1 shadow-lg">
          {TURN_INTO.map((t) => {
            const active = t.isActive(editor);
            return (
              <button
                key={t.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  t.run(editor);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-body tracking-body transition-colors ${
                  active
                    ? 'bg-surface-hover-solid text-text'
                    : 'text-text-muted hover:bg-surface-hover-solid hover:text-text'
                }`}
              >
                {t.label}
                {active && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M20 6L9 17l-5-5"
                      stroke="var(--status-ok)"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
