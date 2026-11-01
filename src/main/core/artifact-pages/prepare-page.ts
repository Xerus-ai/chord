import { statSync } from 'node:fs';
import { PAGE_THEME_QUERY_PARAM, type PageTheme } from '@shared/artifact-frame-constants';
import { bundleMdx } from '@main/core/artifacts/bundle-mdx';
import { bundlePrototype } from './bundle-prototype';
import { artifactPageOrigin } from './page-response-headers';
import type { FilePageSource, PageSource } from './page-source-registry';
import { wrapMdxBundleAsPageScript } from './render-page-document';

interface InputStamp {
  mtimeMs: number;
  size: number;
}

interface PreparedBundle {
  script: string;
  /** Stamp of every file the build read, keyed by real path. */
  inputs: Map<string, InputStamp>;
}

/**
 * Compiled bundles for `mdx` and `prototype` pages, keyed by page id. Bundling
 * happens when the renderer asks to open the page (`preparePage`), never inside
 * the protocol handler: that is where a build error becomes a typed RPC error
 * the host can show, instead of a blank frame. The protocol only serves what
 * was prepared.
 *
 * A bundle is reused while every input it was built from — the entry and each
 * file the bundler read — still has the same mtime and size; touching an
 * imported sibling rebuilds. Concurrent prepares for one page share one build,
 * so a slower older build can never overwrite a newer one. A failed build
 * evicts the previous bundle: an open frame reloading a page whose source no
 * longer compiles gets 409 from the protocol, not the last good output.
 */
const bundles = new Map<string, PreparedBundle>();
const inFlight = new Map<string, Promise<void>>();

function stampInputs(paths: Iterable<string>): Map<string, InputStamp> {
  const stamps = new Map<string, InputStamp>();
  for (const path of paths) {
    const stat = statSync(path);
    stamps.set(path, { mtimeMs: stat.mtimeMs, size: stat.size });
  }
  return stamps;
}

function isFresh(bundle: PreparedBundle): boolean {
  for (const [path, stamp] of bundle.inputs) {
    let current: InputStamp;
    try {
      const stat = statSync(path);
      current = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      // The input is gone; the bundle must be rebuilt (and will fail loudly).
      return false;
    }
    if (current.mtimeMs !== stamp.mtimeMs || current.size !== stamp.size) return false;
  }
  return true;
}

async function compile(source: FilePageSource): Promise<PreparedBundle> {
  if (source.kind === 'mdx') {
    const built = await bundleMdx({
      filePath: source.filePath,
      allowedRoots: source.allowedRoots,
      source: source.inlineSource,
    });
    return { script: wrapMdxBundleAsPageScript(built.code), inputs: stampInputs(built.inputs) };
  }
  if (source.kind === 'prototype') {
    const built = await bundlePrototype({
      entryPath: source.filePath,
      allowedRoots: source.allowedRoots,
      source: source.inlineSource,
    });
    return { script: built.code, inputs: stampInputs(built.inputs) };
  }
  throw new Error(`Page kind '${source.kind}' has no bundle`);
}

async function ensureBundle(source: FilePageSource): Promise<void> {
  const cached = bundles.get(source.pageId);
  if (cached && isFresh(cached)) return;

  let pending = inFlight.get(source.pageId);
  if (!pending) {
    pending = compile(source)
      .then(
        (bundle) => {
          bundles.set(source.pageId, bundle);
        },
        (error: unknown) => {
          bundles.delete(source.pageId);
          throw error;
        }
      )
      .finally(() => inFlight.delete(source.pageId));
    inFlight.set(source.pageId, pending);
  }
  await pending;
}

/**
 * Builds (or reuses) the page's bundle and returns the frame URL. Throws with
 * the compiler's message on failure — callers map that to an RPC error. A web
 * page and an uploaded view (`snapshot`) have nothing to compile.
 */
export async function preparePage(source: PageSource, theme: PageTheme): Promise<string> {
  if (source.kind === 'file') throw new Error('A file is served from its bytes, not prepared');
  if (source.kind === 'mdx' || source.kind === 'prototype') await ensureBundle(source);
  const url = new URL(`${artifactPageOrigin(source.pageId)}/`);
  url.searchParams.set(PAGE_THEME_QUERY_PARAM, theme);
  return url.toString();
}

export function findPreparedBundle(pageId: string): string | undefined {
  return bundles.get(pageId.toLowerCase())?.script;
}

/** Tests only. */
export function clearPreparedBundlesForTest(): void {
  bundles.clear();
  inFlight.clear();
}
