import { readFile } from 'node:fs/promises';
import { bundleMdx } from '@main/core/artifacts/bundle-mdx';
import { bundlePrototype, PAGE_MOUNT_ID } from './bundle-prototype';
import { inlineWebPageAssets } from './inline-web-page-assets';
import { createPageAssetReader } from './page-snapshot-assets';
import {
  hostHeadMarkup,
  inlineScriptTag,
  inlineStyleTag,
  readRuntimeFile,
  RUNTIME_VIEW_FILES,
} from './page-snapshot-markup';
import type { FilePageSource, PageSource } from './page-source-registry';
import {
  componentPageBodyClass,
  insertIntoDocumentHead,
  wrapMdxBundleAsPageScript,
} from './render-page-document';

/** The server refuses larger views (413); refusing here names the cause at publish. */
export const MAX_PAGE_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export interface PageSnapshot {
  /** One HTML document that needs nothing but itself. */
  html: string;
  /** Remote references the view's frame will block — told to the agent at publish. */
  warnings: string[];
}

function mebibytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function buildWebPageSnapshot(
  source: FilePageSource,
  runtimeDir: string
): Promise<PageSnapshot> {
  const authored = source.inlineSource ?? (await readFile(source.filePath, 'utf-8'));
  const assets = createPageAssetReader(source.filePath);
  const inlined = await inlineWebPageAssets(authored, source.filePath, assets);
  return {
    html: insertIntoDocumentHead(inlined, hostHeadMarkup(runtimeDir)),
    warnings: assets.warnings,
  };
}

async function compileComponentScript(source: FilePageSource): Promise<string> {
  if (source.kind === 'mdx') {
    const built = await bundleMdx({
      filePath: source.filePath,
      allowedRoots: source.allowedRoots,
      source: source.inlineSource,
    });
    return wrapMdxBundleAsPageScript(built.code);
  }
  const built = await bundlePrototype({
    entryPath: source.filePath,
    allowedRoots: source.allowedRoots,
    source: source.inlineSource,
  });
  return built.code;
}

/**
 * The same skeleton the frame serves (render-page-document.ts
 * renderComponentPageDocument), with every piece inline and as a classic
 * script: the standalone runtime sets the globals the bundle was compiled
 * against, then the bundle mounts. mermaid (~3 MB) rides along only when the
 * bundle names the diagram component.
 */
async function buildComponentPageSnapshot(
  source: FilePageSource & { kind: 'mdx' | 'prototype' },
  runtimeDir: string
): Promise<PageSnapshot> {
  const bundle = await compileComponentScript(source);
  const scripts = [
    bundle.includes('MermaidDiagram')
      ? inlineScriptTag(readRuntimeFile(runtimeDir, RUNTIME_VIEW_FILES.mermaid))
      : '',
    inlineScriptTag(readRuntimeFile(runtimeDir, RUNTIME_VIEW_FILES.runtime)),
    inlineScriptTag(bundle),
  ];
  const html = [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    hostHeadMarkup(runtimeDir),
    inlineStyleTag(readRuntimeFile(runtimeDir, RUNTIME_VIEW_FILES.components)),
    '</head>',
    `<body class="${componentPageBodyClass(source.kind)}">`,
    `<div id="${PAGE_MOUNT_ID}"></div>`,
    ...scripts,
    '</body>',
    '</html>',
  ].join('');
  return { html, warnings: [] };
}

/**
 * Builds the self-contained view of a page version (design 2026-09-24 §9
 * "View document format") — what teammates and public links see when the
 * author's machine is off. `runtimeDir` is `out/artifact-runtime/`. Fails with
 * the compiler's message, a missing local asset, or a view over the cap.
 */
export async function buildPageSnapshot(args: {
  source: PageSource;
  runtimeDir: string;
}): Promise<PageSnapshot> {
  const { source, runtimeDir } = args;
  if (source.kind === 'snapshot') {
    throw new Error('An uploaded view is already a snapshot; it is not built again');
  }
  if (source.kind === 'file') {
    throw new Error('A file is shown from its bytes or its file view, not a page view');
  }
  const snapshot =
    source.kind === 'html'
      ? await buildWebPageSnapshot(source, runtimeDir)
      : await buildComponentPageSnapshot({ ...source, kind: source.kind }, runtimeDir);
  const bytes = Buffer.byteLength(snapshot.html, 'utf-8');
  if (bytes > MAX_PAGE_SNAPSHOT_BYTES) {
    throw new Error(
      `The page's shared view is ${mebibytes(bytes)} MiB, over the 8 MiB limit. Shrink or remove large images and assets, then publish again.`
    );
  }
  return snapshot;
}
