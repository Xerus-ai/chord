import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Markup helpers for a page's self-contained view (build-page-snapshot.ts):
 * everything is inline, so text that would end its own element early is
 * escaped before it goes in.
 */

/**
 * `</script` ends a script element wherever it appears, and `<!--` can switch
 * the parser into a state where a later `</script>` no longer ends it. Inside
 * a JS string, regex or comment, `<\/script` and `<\!--` mean the same text.
 */
export function escapeInlineScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** `</style` ends a style element; `\/` is the same character to CSS. */
export function escapeInlineStyle(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

export function inlineScriptTag(code: string, attributes = ''): string {
  return `<script${attributes}>${escapeInlineScript(code)}</script>`;
}

export function inlineStyleTag(css: string, attributes = ''): string {
  return `<style${attributes}>${escapeInlineStyle(css)}</style>`;
}

export function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** The runtime files a view inlines, from `out/artifact-runtime/`. */
export const RUNTIME_VIEW_FILES = {
  tokens: 'tokens.css',
  bridge: 'chord-page.js',
  components: 'components.css',
  runtime: 'runtime-standalone.js',
  mermaid: 'mermaid-standalone.js',
  docxViewer: 'docx-viewer-standalone.js',
} as const;

export function readRuntimeFile(
  runtimeDir: string,
  name: (typeof RUNTIME_VIEW_FILES)[keyof typeof RUNTIME_VIEW_FILES]
): string {
  const path = join(runtimeDir, name);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`The page runtime is incomplete: ${path} is missing. Rebuild the app runtime.`);
  }
  return readFileSync(path, 'utf-8');
}

/** The token sheet and the frame bridge every view starts with. */
export function hostHeadMarkup(runtimeDir: string): string {
  return (
    inlineStyleTag(readRuntimeFile(runtimeDir, RUNTIME_VIEW_FILES.tokens)) +
    inlineScriptTag(readRuntimeFile(runtimeDir, RUNTIME_VIEW_FILES.bridge))
  );
}
