import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Settings,
} from 'lucide-react';
import { createElement } from 'react';
import { statusTextClass } from '@renderer/lib/status-dot';
import { cn } from '@renderer/utils/utils';
import { gitChangeSignal } from './status-dot';

/**
 * File and folder glyphs for the Explorer and Source Control rows.
 *
 * Deliberately Lucide plus git-status colour, not a Material icon theme: the
 * theme is ~1000 SVGs behind a new dependency, and this rail adds no
 * dependencies. Extension mapping stays coarse on purpose — a glyph per file
 * family reads as structure, a glyph per language reads as noise at 14px.
 */
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rs',
  'go',
  'java',
  'rb',
  'c',
  'h',
  'cc',
  'cpp',
  'cs',
  'swift',
  'kt',
  'sh',
  'sql',
  'css',
  'scss',
  'html',
  'vue',
  'svelte',
]);
const DATA_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'lock']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'avif']);
const CONFIG_NAMES = new Set(['.gitignore', '.env', 'dockerfile', 'makefile', '.editorconfig']);

function glyphFor(fileName: string) {
  const lower = fileName.toLowerCase();
  if (CONFIG_NAMES.has(lower)) return Settings;
  const extension = lower.includes('.') ? (lower.split('.').pop() ?? '') : '';
  if (CODE_EXTENSIONS.has(extension)) return FileCode;
  if (DATA_EXTENSIONS.has(extension)) return FileJson;
  if (IMAGE_EXTENSIONS.has(extension)) return FileImage;
  return FileText;
}

/**
 * `gitStatus` tints the glyph with the status token for that change — the same
 * token the diff stat next to it uses, per the one-token-per-signal rule.
 */
export function FileGlyph({ fileName, gitStatus }: { fileName: string; gitStatus?: string }) {
  const tone = gitStatus ? statusTextClass(gitChangeSignal(gitStatus)) : 'text-text-passive';
  return createElement(glyphFor(fileName), { className: cn('size-icon-sm shrink-0', tone) });
}

export function FolderGlyph({ expanded }: { expanded: boolean }) {
  const Glyph = expanded ? FolderOpen : Folder;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {expanded ? (
        <ChevronDown className="size-icon-xs text-text-passive" />
      ) : (
        <ChevronRight className="size-icon-xs text-text-passive" />
      )}
      <Glyph className="size-icon-sm text-text-passive" />
    </span>
  );
}
