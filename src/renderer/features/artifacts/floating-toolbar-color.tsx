import type { Editor } from '@tiptap/react';
import { useDropdown } from './use-dropdown';

// Colors reference theme tokens by CSS variable — never hardcoded hex — so
// text/highlight colors track the active theme and stay token-compliant.
const COLORS: { label: string; varName: string }[] = [
  { label: 'Green', varName: '--status-ok' },
  { label: 'Amber', varName: '--status-warn' },
  { label: 'Blue', varName: '--status-running' },
  { label: 'Red', varName: '--status-err' },
  { label: 'Violet', varName: '--status-merged' },
];

// Neutral highlight = the same token the one-click Highlight button used to
// apply, so an uncolored highlight is still reachable after the merge.
const NEUTRAL_HIGHLIGHT = '--selection-bg';

// The stored value is the token reference itself, not what the token resolved to
// at click time. Baking the resolved hex into the document froze the colour to
// whichever theme happened to be active — the same span then read as light-theme
// red inside a dark document, and every peer stored a different literal.
function tokenReference(varName: string): string {
  return `var(${varName})`;
}

export function ColorPopover({ editor }: { editor: Editor }) {
  const { open, setOpen, ref } = useDropdown();

  const setTextColor = (varName: string) => {
    editor.chain().focus().setColor(tokenReference(varName)).run();
    setOpen(false);
  };
  const clearTextColor = () => {
    editor.chain().focus().unsetColor().run();
    setOpen(false);
  };
  const setHighlightColor = (varName: string) => {
    editor
      .chain()
      .focus()
      .setHighlight({ color: tokenReference(varName) })
      .run();
    setOpen(false);
  };
  const clearHighlight = () => {
    editor.chain().focus().unsetHighlight().run();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        title="Color & highlight"
        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 transition-colors active:scale-95 ${
          open
            ? 'bg-surface-hover-solid text-text'
            : 'text-text-passive hover:bg-surface-hover-solid hover:text-text-muted'
        }`}
      >
        <span
          className="h-3.5 w-3.5 rounded-full border border-border-strong"
          style={{
            background:
              'conic-gradient(var(--action-bg), var(--status-ok), var(--status-running), var(--status-err), var(--action-bg))',
          }}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-52 rounded-lg border border-border-strong bg-surface-inset p-2 shadow-lg">
          <SwatchRow label="Text" onColor={setTextColor}>
            <SwatchButton title="Default" onClick={clearTextColor}>
              <span className="text-tiny tracking-tiny font-medium text-text-passive">A</span>
            </SwatchButton>
          </SwatchRow>
          <SwatchRow label="Highlight" onColor={setHighlightColor}>
            <SwatchButton
              title="Neutral highlight"
              onClick={() => setHighlightColor(NEUTRAL_HIGHLIGHT)}
            >
              <span
                className="h-3.5 w-3.5 rounded-sm"
                style={{ background: `var(${NEUTRAL_HIGHLIGHT})` }}
              />
            </SwatchButton>
            <SwatchButton title="Clear highlight" onClick={clearHighlight}>
              <span className="text-tiny tracking-tiny font-medium text-text-passive">✕</span>
            </SwatchButton>
          </SwatchRow>
        </div>
      )}
    </div>
  );
}

function SwatchRow({
  label,
  onColor,
  children,
}: {
  label: string;
  onColor: (varName: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1 last:mb-0">
      <div className="px-1 pb-1 text-micro tracking-micro font-semibold uppercase text-text-passive">
        {label}
      </div>
      <div className="flex flex-wrap gap-1">
        {children}
        {COLORS.map((c) => (
          <SwatchButton key={c.label} title={c.label} onClick={() => onColor(c.varName)}>
            <span
              className="h-3.5 w-3.5 rounded-full"
              style={{ background: `var(${c.varName})` }}
            />
          </SwatchButton>
        ))}
      </div>
    </div>
  );
}

function SwatchButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      className="flex h-6 w-6 items-center justify-center rounded-md border border-border transition-colors hover:border-border-strong"
    >
      {children}
    </button>
  );
}
