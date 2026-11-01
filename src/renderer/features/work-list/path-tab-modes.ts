import {
  artifactTypeForPath,
  renderClassForArtifactType,
  type ArtifactRenderClass,
} from '@shared/artifact-render-class';
import type { PathMode } from './center-tab';

/**
 * How a path renders its Preview (design 2026-09-26 §3):
 * - `page` — a `chord-artifact://` frame (.html, .tsx, .mdx);
 * - `document` — the co-edited TipTap editor (a .md or .txt artifact);
 * - `markdown` — a read-only render (a .md that is not an artifact);
 * - `binary` — the file viewers of design 2026-09-24 §10 (pdf, docx, pptx, images);
 * - `source` — no preview: the source is the view.
 */
export type PathFormat = 'page' | 'document' | 'markdown' | 'binary' | 'source';

const FORMAT_BY_RENDER_CLASS: Record<ArtifactRenderClass, PathFormat> = {
  page: 'page',
  document: 'document',
  file: 'binary',
};

/**
 * An artifact's format is its render class; a plain file's comes from its
 * extension, where only a `.md` counts as a document (read-only markdown) — a
 * `.txt` that is not an artifact is plain source.
 */
export function pathFormat(input: {
  filePath: string | undefined;
  renderClass?: ArtifactRenderClass;
}): PathFormat {
  if (input.renderClass) return FORMAT_BY_RENDER_CLASS[input.renderClass];
  const type = input.filePath ? artifactTypeForPath(input.filePath) : null;
  if (type === null) return 'source';
  if (type === 'markdown') return 'markdown';
  if (type === 'text') return 'source';
  return FORMAT_BY_RENDER_CLASS[renderClassForArtifactType(type)];
}

export interface ResolvedPathModes {
  /** In display order: Diff · Preview · Edit. */
  modes: readonly PathMode[];
  defaultMode: PathMode;
}

/**
 * The modes a path tab offers, from what the file can show and what the
 * viewer may use (`allowed`: the capabilities' `documentModes` for an
 * artifact, `fileModes` for a plain file). Diff needs changes and a file; a
 * binary or a file-less artifact only previews; plain source has no preview.
 * A viewer allowed only Diff keeps it after the changes leave the snapshot:
 * the diff's body says they did.
 */
export function resolvePathModes(input: {
  format: PathFormat;
  hasFile: boolean;
  hasChanges: boolean;
  allowed: readonly PathMode[];
}): ResolvedPathModes {
  const { format, hasFile, hasChanges, allowed } = input;
  const may = (mode: PathMode) => allowed.includes(mode);

  if (format === 'binary' || !hasFile) {
    if (!may('preview')) throw new Error(`Nothing this viewer may use shows a ${format}`);
    return { modes: ['preview'], defaultMode: 'preview' };
  }

  const diffOnly = allowed.length === 1 && may('diff');
  const diff: PathMode[] = may('diff') && (hasChanges || diffOnly) ? ['diff'] : [];
  const modes: PathMode[] =
    format === 'source'
      ? [...diff, ...(may('edit') ? (['edit'] as const) : [])]
      : [
          ...diff,
          ...(may('preview') ? (['preview'] as const) : []),
          ...(may('edit') ? (['edit'] as const) : []),
        ];
  if (modes.length === 0) throw new Error(`Nothing this viewer may use shows a ${format} file`);

  const preferred: PathMode = format === 'source' ? 'edit' : 'preview';
  return { modes, defaultMode: modes.includes(preferred) ? preferred : modes[0] };
}

/** The mode a tab shows: its own if still offered (a committed file loses Diff), else the default. */
export function effectivePathMode(
  tabMode: PathMode | undefined,
  resolved: ResolvedPathModes
): PathMode {
  return tabMode !== undefined && resolved.modes.includes(tabMode) ? tabMode : resolved.defaultMode;
}

const MODE_LABELS: Record<PathMode, string> = { diff: 'Diff', preview: 'Preview', edit: 'Edit' };

/** The switch's label; Edit reads "Source" for someone who cannot edit. */
export function pathModeLabel(mode: PathMode, canEdit: boolean): string {
  return mode === 'edit' && !canEdit ? 'Source' : MODE_LABELS[mode];
}
