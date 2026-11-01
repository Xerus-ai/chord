import { AlignJustify, Columns2, FileWarning, Loader2 } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import type { DiffContent } from './cloud-diff-content';
import { detectLanguage, MonacoDiffMount } from './monaco-diff-mount';
import { useDiffLayoutMode } from './use-diff-layout-mode';

function DiffNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <FileWarning className="h-5 w-5 text-text-passive" />
      <span className="text-body tracking-body font-medium text-text-muted">{title}</span>
      <span className="max-w-[420px] text-tiny tracking-tiny text-text-passive">{description}</span>
    </div>
  );
}

/**
 * One file's diff, for the owner and a teammate alike: the file bar above
 * names the path, this row carries the diff's own facts (how much changed),
 * the layout, and whatever actions the viewer has (the owner's Undo All and
 * Apply All). Where the two sides come from is the container's business
 * (`LocalDiff`, `CloudDiff`).
 */
export function DiffBody({
  filePath,
  stats,
  content,
  actions,
}: {
  filePath: string;
  /** Null when the counts are unknown. */
  stats: { added: number; removed: number } | null;
  content: DiffContent;
  actions?: ReactNode;
}) {
  // The user's preference, not what gets rendered: a pane too narrow for two
  // columns falls back to unified without discarding the choice.
  const [preferSideBySide, setPreferSideBySide] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const { renderSideBySide, canSplit } = useDiffLayoutMode(containerRef, preferSideBySide);

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-raised px-5 py-2">
        <span className="shrink-0 font-mono text-tiny tracking-tiny font-normal text-text-muted">
          {stats && (
            <>
              <span className="text-status-ok">+{stats.added}</span>{' '}
              <span className="text-status-err">-{stats.removed}</span>
            </>
          )}
        </span>
        <div className="flex min-w-0 items-center justify-end gap-3">
          <SegmentedControl
            size="xs"
            ariaLabel="Diff layout"
            value={renderSideBySide ? 'split' : 'unified'}
            onChange={(mode) => setPreferSideBySide(mode === 'split')}
            options={[
              {
                value: 'split',
                label: 'Split',
                icon: Columns2,
                disabledReason: canSplit ? undefined : 'Pane too narrow for split view',
              },
              { value: 'unified', label: 'Unified', icon: AlignJustify },
            ]}
          />
          {actions}
        </div>
      </div>
      {content.kind === 'loading' ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-body tracking-body text-text-passive">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading diff…
        </div>
      ) : content.kind === 'failed' ? (
        <div className="flex flex-1 items-center justify-center text-body tracking-body text-status-err">
          Failed to load diff
        </div>
      ) : content.kind === 'notice' ? (
        <DiffNotice title={content.title} description={content.description} />
      ) : (
        <div className="flex-1 overflow-hidden">
          <MonacoDiffMount
            original={content.original}
            modified={content.modified}
            language={detectLanguage(filePath)}
            renderSideBySide={renderSideBySide}
            hideUnchangedRegions={content.hideUnchangedRegions}
          />
        </div>
      )}
    </div>
  );
}
