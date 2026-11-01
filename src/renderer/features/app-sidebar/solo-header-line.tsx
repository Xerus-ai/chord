import type { SoloHeaderModel } from './solo-header-model';

/**
 * The repo header's Solo line, under the header row: "Soloing <work item>"
 * (+ "· n queued") focuses the holder's work item; "Solo interrupted" offers
 * Restore.
 */
export function SoloHeaderLine({
  model,
  onFocusWorkItem,
  onRestore,
}: {
  model: SoloHeaderModel;
  onFocusWorkItem: (workItemId: string) => void;
  onRestore: () => void;
}) {
  const { action } = model;
  // Indented with padding, not a margin, so the line never grows past the
  // sidebar. Only the name truncates (a flex box does not ellipsize its own
  // text, so the name is a span of its own); the queue count stays whole, and
  // the whole line is in the hover.
  if (action.kind === 'focus') {
    return (
      <div className="flex h-5 min-w-0 items-center pr-2 pl-7">
        <button
          type="button"
          title={model.title}
          onClick={() => onFocusWorkItem(action.workItemId)}
          className="flex min-w-0 cursor-pointer border-none bg-transparent p-0 text-left text-list-meta text-status-ok hover:underline"
        >
          <span className="min-w-0 truncate">{model.text}</span>
          {model.queued && <span className="shrink-0 whitespace-pre">{` · ${model.queued}`}</span>}
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-5 min-w-0 items-center gap-2 pr-2 pl-7 text-list-meta">
      <span title={model.title} className="min-w-0 truncate text-status-warn">
        {model.text}
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-text-muted hover:text-text hover:underline"
      >
        Restore
      </button>
    </div>
  );
}
