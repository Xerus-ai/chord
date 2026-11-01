import { useLayoutEffect, useRef, useState } from 'react';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { FOCUS_RING } from '@renderer/lib/ui/focus-ring';
import { cn } from '@renderer/utils/utils';
import { useOpenCenterTabs, type OpenTabOptions } from './center-tabs-store';
import { describeArtifactPath } from './turn-artifacts';

export interface ArtifactChipData {
  /** Absent on legacy rows: the chip renders, but there is nothing to open. */
  artifactId?: string;
  title: string;
  filePath?: string;
}

export type OpenArtifactHandler = (
  artifactId: string,
  title: string,
  options?: OpenTabOptions
) => void;

/** Two 28px rows plus the 6px gap between them. */
const COLLAPSED_MAX_HEIGHT = 62;

/**
 * The files a turn created, as document chips. They sit at the end of the
 * turn instead of between its paragraphs: one row of chips replaces a stack of
 * cards, and the prose reads through uninterrupted.
 *
 * Click opens a preview tab, double-click a permanent one — the tab is the
 * viewer, so the chip has no actions of its own.
 */
export function TurnArtifactChips({
  artifacts,
  workItemId,
  workspaceRoot,
  onOpenArtifact,
}: {
  artifacts: ArtifactChipData[];
  /** Absent for rows rendered outside a work item; chips then can't mark open tabs. */
  workItemId?: string;
  workspaceRoot: string | null;
  onOpenArtifact?: OpenArtifactHandler;
}) {
  const openTabs = useOpenCenterTabs(workItemId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const chips = Array.from(el.children) as HTMLElement[];
      const firstTop = chips[0]?.offsetTop ?? 0;
      setHiddenCount(
        chips.filter((chip) => chip.offsetTop - firstTop >= COLLAPSED_MAX_HEIGHT - 20).length
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [artifacts]);

  if (artifacts.length === 0) return null;

  return (
    <div className="mt-3">
      <div
        ref={containerRef}
        className="flex flex-wrap gap-1.5 overflow-hidden"
        style={expanded ? undefined : { maxHeight: COLLAPSED_MAX_HEIGHT }}
      >
        {artifacts.map((artifact) => {
          const { directory, fileName } = describeArtifactPath(
            artifact.filePath ?? artifact.title,
            workspaceRoot
          );
          const artifactId = artifact.artifactId;
          const isOpen =
            !!artifactId &&
            !!openTabs?.some((t) => t.kind === 'path' && t.artifactId === artifactId);
          return (
            <button
              key={artifactId ?? artifact.title}
              type="button"
              disabled={!artifactId || !onOpenArtifact}
              title={artifact.filePath ? `Open · ${artifact.filePath}` : `Open · ${artifact.title}`}
              onClick={
                artifactId && onOpenArtifact
                  ? () => onOpenArtifact(artifactId, artifact.title, { preview: true })
                  : undefined
              }
              onDoubleClick={
                artifactId && onOpenArtifact
                  ? () => onOpenArtifact(artifactId, artifact.title, { preview: false })
                  : undefined
              }
              className={cn(
                'flex h-7 max-w-[280px] min-w-0 cursor-pointer items-center gap-2 rounded-xl border bg-surface px-2.5 text-left shadow-[var(--shadow-sm)] transition-colors duration-100 hover:bg-surface-inset disabled:cursor-default disabled:hover:bg-surface',
                isOpen ? 'border-border-strong' : 'border-border',
                FOCUS_RING
              )}
            >
              <span className="flex shrink-0 items-center text-text-passive">
                <FileIcon filename={fileName} size={12} className="h-3 w-3" />
              </span>
              {/* Truncates from the left so the file name always survives. */}
              <span
                dir="rtl"
                className="min-w-0 truncate text-tiny tracking-tiny [unicode-bidi:plaintext]"
              >
                <span className="text-text-passive">{directory}</span>
                <span className="text-text">{fileName}</span>
              </span>
            </button>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`mt-1.5 cursor-pointer rounded-md border-none bg-transparent px-1 py-0.5 text-tiny tracking-tiny text-text-passive transition-colors hover:text-text-muted ${FOCUS_RING}`}
        >
          {expanded ? 'Show less' : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
