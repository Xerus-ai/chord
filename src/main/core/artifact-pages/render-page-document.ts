import { PAGE_MOUNT_ID } from './bundle-prototype';
import { ARTIFACT_PAGE_SCHEME } from './page-response-headers';

/**
 * Reserved path prefix for everything the host injects into a page. A web
 * page's own assets are resolved relative to its file, so a sibling named
 * `tokens.css` never shadows the host's sheet.
 */
export const HOST_ASSET_PREFIX = '/__chord/';

export const HOST_ASSETS = {
  tokens: `${HOST_ASSET_PREFIX}tokens.css`,
  components: `${HOST_ASSET_PREFIX}components.css`,
  runtime: `${HOST_ASSET_PREFIX}runtime.js`,
  bridge: `${HOST_ASSET_PREFIX}chord-page.js`,
  bundle: `${HOST_ASSET_PREFIX}bundle.js`,
} as const;

/** Runtime code-split chunks: `/__chord/chunks/<name>-<hash>.js`. */
export const RUNTIME_CHUNK_PREFIX = `${HOST_ASSET_PREFIX}chunks/`;

/** Files under `out/artifact-runtime/` that are served verbatim. */
export const RUNTIME_DIR_ASSETS: Record<string, string> = {
  [HOST_ASSETS.tokens]: 'tokens.css',
  [HOST_ASSETS.components]: 'components.css',
  [HOST_ASSETS.runtime]: 'runtime.js',
  [HOST_ASSETS.bridge]: 'chord-page.js',
};

function assetUrl(pageId: string, asset: string): string {
  return `${ARTIFACT_PAGE_SCHEME}://${pageId}${asset}`;
}

/**
 * Absolute URLs, not relative: `base-uri 'none'` forbids `<base>`, but a page
 * served at a nested asset path would still resolve relative hrefs against
 * its own directory. The origin is the page id, so absolute is unambiguous.
 */
function hostHeadTags(pageId: string): string {
  return [
    `<link rel="stylesheet" href="${assetUrl(pageId, HOST_ASSETS.tokens)}">`,
    `<script src="${assetUrl(pageId, HOST_ASSETS.bridge)}"></script>`,
  ].join('');
}

/** Byte ranges of `<!-- … -->` comments, so a tag inside one is not mistaken for markup. */
function commentRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const comment = /<!--[\s\S]*?-->/g;
  let match: RegExpExecArray | null;
  while ((match = comment.exec(html)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** The end offset of the first real `<tag …>` — one that is not inside a comment. */
function findOpeningTagEnd(html: string, tag: string, comments: Array<[number, number]>): number {
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const at = match.index;
    if (!comments.some(([start, end]) => at >= start && at < end)) return at + match[0].length;
  }
  return -1;
}

/**
 * Inserts `injected` as the first children of the document's head: after the
 * first opening `<head>` outside any comment when there is one, otherwise in a
 * new head just inside `<html>`, otherwise at the top of a whole new document
 * — a bare fragment still gets them.
 */
export function insertIntoDocumentHead(authored: string, injected: string): string {
  const comments = commentRanges(authored);
  const headEnd = findOpeningTagEnd(authored, 'head', comments);
  if (headEnd >= 0) return authored.slice(0, headEnd) + injected + authored.slice(headEnd);
  const htmlEnd = findOpeningTagEnd(authored, 'html', comments);
  if (htmlEnd >= 0) {
    return `${authored.slice(0, htmlEnd)}<head>${injected}</head>${authored.slice(htmlEnd)}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8">${injected}</head><body>${authored}</body></html>`;
}

/**
 * A web page (`.html`) is the author's document with the host's token sheet
 * inserted as the first stylesheet and the frame bridge as the first script.
 */
export function renderHtmlPageDocument(pageId: string, authored: string): string {
  return insertIntoDocumentHead(authored, hostHeadTags(pageId));
}

/** The body class of a component page; an MDX page keeps the embedded look. */
export function componentPageBodyClass(kind: 'mdx' | 'prototype'): string {
  return kind === 'mdx' ? 'chord-page chord-page-embedded' : 'chord-page';
}

/**
 * MDX components and prototypes share one skeleton: the vendored runtime
 * (React, recharts, chord-components), then the compiled bundle, which mounts
 * itself into the mount node. No inline script is needed, so a bundle that
 * happens to contain `</script>` cannot break the document.
 */
export function renderComponentPageDocument(pageId: string, kind: 'mdx' | 'prototype'): string {
  const classAttr = ` class="${componentPageBodyClass(kind)}"`;
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    hostHeadTags(pageId),
    `<link rel="stylesheet" href="${assetUrl(pageId, HOST_ASSETS.components)}">`,
    '</head>',
    `<body${classAttr}>`,
    `<div id="${PAGE_MOUNT_ID}"></div>`,
    `<script type="module" src="${assetUrl(pageId, HOST_ASSETS.runtime)}"></script>`,
    `<script type="module" src="${assetUrl(pageId, HOST_ASSETS.bundle)}"></script>`,
    '</body>',
    '</html>',
  ].join('');
}

/**
 * mdx-bundler emits a function body (`var Component=…;return Component;`)
 * that reads React, the JSX runtime and every `globals` entry as free
 * variables. It used to be run through `new Function` in the renderer; here it
 * is wrapped into a plain script that binds those names from the runtime's
 * globals and mounts the default export.
 */
export function wrapMdxBundleAsPageScript(code: string): string {
  return [
    '(function(){',
    '"use strict";',
    'var mount=document.getElementById(' + JSON.stringify(PAGE_MOUNT_ID) + ');',
    'if(!mount){throw new Error("Page document has no mount node");}',
    'var exportsObject=(function(React,ReactDOM,_jsx_runtime,Recharts,ChordComponents){',
    code,
    '})(window.React,window.ReactDOM,window._jsx_runtime,window.Recharts,window.ChordComponents);',
    'window.ReactDOMClient.createRoot(mount).render(window.React.createElement(exportsObject.default));',
    '})();',
  ].join('\n');
}
