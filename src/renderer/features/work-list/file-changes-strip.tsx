import { ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import { useState } from 'react';

export interface FileChangeEntry {
  name: string;
  filePath: string;
  added: number;
  removed: number;
}

interface FileChangesStripProps {
  files: FileChangeEntry[];
  onFileSelect?: (filePath: string) => void;
  onReview?: () => void;
}

function DiffStats({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-xs border border-border/40 px-2 py-0.5 font-mono text-tiny tracking-tiny leading-[1.3]">
      {added > 0 && <span className="text-status-ok">+{added}</span>}
      {added > 0 && removed > 0 && <span className="text-text-passive/40">&thinsp;</span>}
      {removed > 0 && <span className="text-status-err">-{removed}</span>}
    </span>
  );
}

export function FileChangesStrip({ files, onFileSelect, onReview }: FileChangesStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) return null;

  const totalAdded = files.reduce((sum, f) => sum + f.added, 0);
  const totalRemoved = files.reduce((sum, f) => sum + f.removed, 0);
  const singleFile = files.length === 1;

  return (
    <div className="mt-2 overflow-hidden rounded-[var(--radius-sm)] border border-border/40 bg-surface-raised/40">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left transition-colors duration-100 hover:bg-surface-inset/30"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-passive/60" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-text-passive/60" />
        )}

        <span className="text-body tracking-body font-medium text-text-muted">
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>

        {singleFile && (
          <span className="min-w-0 truncate font-mono text-tiny tracking-tiny text-text-passive">
            {files[0].name}
          </span>
        )}

        <span className="flex-1" />

        <DiffStats added={totalAdded} removed={totalRemoved} />

        {onReview && (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            className="ml-1 cursor-pointer rounded-xs px-2 py-0.5 text-tiny tracking-tiny font-medium text-text-passive transition-colors hover:bg-surface-hover-solid hover:text-text-muted"
          >
            Review
          </span>
        )}
      </button>

      {expanded && files.length > 1 && (
        <div className="border-t border-border/30">
          {files.map((file) => (
            <button
              key={file.filePath}
              onClick={() => onFileSelect?.(file.filePath)}
              className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-tiny tracking-tiny transition-colors duration-75 hover:bg-surface-inset/30"
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0 text-text-passive/60" />
              <span className="min-w-0 flex-1 truncate font-mono text-text-muted">{file.name}</span>
              <DiffStats added={file.added} removed={file.removed} />
            </button>
          ))}
        </div>
      )}

      {expanded && singleFile && files[0] && (
        <div className="border-t border-border/30">
          <button
            onClick={() => onFileSelect?.(files[0].filePath)}
            className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left text-tiny tracking-tiny transition-colors duration-75 hover:bg-surface-inset/30"
          >
            <FileCode2 className="h-3.5 w-3.5 shrink-0 text-text-passive/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-text-passive">
              {files[0].filePath}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export function extractFileChanges(
  tools: Array<{ kind: string; name: string; locations?: Array<{ filePath: string }> }>
): FileChangeEntry[] {
  const seen = new Set<string>();
  const result: FileChangeEntry[] = [];

  for (const tool of tools) {
    if (tool.kind !== 'edit' || !tool.locations) continue;
    for (const loc of tool.locations) {
      if (seen.has(loc.filePath)) continue;
      seen.add(loc.filePath);
      const segments = loc.filePath.replace(/\\/g, '/').split('/');
      result.push({
        name: segments[segments.length - 1] ?? loc.filePath,
        filePath: loc.filePath,
        added: 0,
        removed: 0,
      });
    }
  }

  return result;
}
