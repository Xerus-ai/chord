/**
 * The `+A -D` pair, in the two forms the app uses.
 *
 * Shared rather than owned by either list: the sidebar and the right rail show
 * the same fact about the same worktree, and a second copy of these is how the
 * two surfaces start disagreeing about what a diff looks like. Neither feature
 * imports the other's directory — both import this.
 */

/** The muted trailing pair a compact row ends with. */
export function DiffText({ added, removed }: { added: number; removed: number }) {
  return (
    // One passive colour, as in the reference: a compact list is scanned for
    // glyph and title, and a red/green pair on every row outshouts both. The
    // coloured pair belongs to the pill and the hover card.
    <span className="shrink-0 font-mono text-list-meta tracking-tiny tabular-nums text-text-passive">
      +{added} -{removed}
    </span>
  );
}

/** The bordered variant — the pill the prototype's `rowA` carries. */
export function DiffPill({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="flex h-[17px] shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 font-mono text-list-badge tracking-tiny tabular-nums">
      <span className="text-diff-add">+{added}</span>
      <span className="text-diff-del">-{removed}</span>
    </span>
  );
}
