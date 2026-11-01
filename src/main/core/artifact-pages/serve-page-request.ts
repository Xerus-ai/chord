import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import {
  artifactPageError,
  artifactPageResponse,
  contentTypeForPath,
} from './page-response-headers';
import { findPageSource, type FilePageSource, type PageSource } from './page-source-registry';
import { isPathInside, isRealPathInside } from './path-containment';
import { findPreparedBundle } from './prepare-page';
import {
  HOST_ASSET_PREFIX,
  HOST_ASSETS,
  renderComponentPageDocument,
  renderHtmlPageDocument,
  RUNTIME_CHUNK_PREFIX,
  RUNTIME_DIR_ASSETS,
} from './render-page-document';

const CHUNK_NAME = /^[A-Za-z0-9_.-]+\.js$/;

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function serveFile(filePath: string, pageId: string): Promise<Response> {
  try {
    const body = await readFile(filePath);
    return artifactPageResponse(body, contentTypeForPath(filePath), pageId);
  } catch (error) {
    if (isEnoent(error)) return artifactPageError(404, 'Not found', pageId);
    throw error;
  }
}

async function serveHostAsset(
  source: FilePageSource,
  pathname: string,
  runtimeDir: string
): Promise<Response> {
  const { pageId } = source;
  if (pathname === HOST_ASSETS.bundle) {
    const script = findPreparedBundle(pageId);
    if (script === undefined) {
      return artifactPageError(404, 'Page bundle has not been prepared', pageId);
    }
    return artifactPageResponse(script, contentTypeForPath('bundle.js'), pageId);
  }
  if (pathname.startsWith(RUNTIME_CHUNK_PREFIX)) {
    const chunk = pathname.slice(RUNTIME_CHUNK_PREFIX.length);
    if (!CHUNK_NAME.test(chunk)) return artifactPageError(404, 'Not found', pageId);
    return serveFile(join(runtimeDir, 'chunks', chunk), pageId);
  }
  const fileName = RUNTIME_DIR_ASSETS[pathname];
  if (!fileName) return artifactPageError(404, 'Not found', pageId);
  return serveFile(join(runtimeDir, fileName), pageId);
}

/**
 * A web page's relative assets are read from the directory that holds its
 * file, and only from there. The decoded path is normalised and checked
 * lexically first, so `..`, encoded separators and absolute paths are refused
 * with 403 before anything is touched; then both sides are realpath'd, so a
 * symlink inside the directory cannot reach out of it either.
 */
async function serveAuthoredAsset(source: FilePageSource, pathname: string): Promise<Response> {
  const { pageId } = source;
  if (source.kind !== 'html') return artifactPageError(404, 'Not found', pageId);
  const baseDir = normalize(dirname(source.filePath));
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return artifactPageError(400, 'Malformed path', pageId);
  }
  const relative = decoded.replace(/^\/+/, '');
  // A backslash is refused on every host: it is a separator on Windows, and a
  // page's assets are never named with one elsewhere.
  if (relative === '' || /^[A-Za-z]:/.test(relative) || relative.includes('\\')) {
    return artifactPageError(403, 'Forbidden', pageId);
  }
  const resolved = normalize(join(baseDir, relative));
  if (resolved === baseDir || !isPathInside(baseDir, resolved)) {
    return artifactPageError(403, 'Forbidden', pageId);
  }
  try {
    if (!isRealPathInside(baseDir, resolved)) return artifactPageError(403, 'Forbidden', pageId);
  } catch (error) {
    if (isEnoent(error)) return artifactPageError(404, 'Not found', pageId);
    throw error;
  }
  return serveFile(resolved, pageId);
}

async function serveDocument(source: PageSource): Promise<Response> {
  const { pageId } = source;
  const type = contentTypeForPath('index.html');
  if (source.kind === 'snapshot') return artifactPageResponse(source.html, type, pageId);
  if (source.kind === 'file') {
    return artifactPageResponse(new Uint8Array(source.bytes), source.mimeType, pageId);
  }
  if (source.kind === 'html') {
    let authored = source.inlineSource;
    if (authored === undefined) {
      try {
        authored = await readFile(source.filePath, 'utf-8');
      } catch (error) {
        if (isEnoent(error)) return artifactPageError(404, 'Page source file not found', pageId);
        throw error;
      }
    }
    return artifactPageResponse(renderHtmlPageDocument(pageId, authored), type, pageId);
  }
  if (findPreparedBundle(pageId) === undefined) {
    return artifactPageError(409, 'Page bundle has not been prepared', pageId);
  }
  return artifactPageResponse(renderComponentPageDocument(pageId, source.kind), type, pageId);
}

/**
 * The handler behind `chord-artifact://`. Exported so tests can drive it with
 * a plain `Request` and assert on headers and status codes without Electron.
 */
export async function handleArtifactPageRequest(
  request: Request,
  runtimeDir: string
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return artifactPageError(405, 'Method not allowed');
  }
  const url = new URL(request.url);
  const source = findPageSource(url.hostname);
  if (!source) return artifactPageError(404, 'Unknown page');

  const pathname = url.pathname;
  if (pathname === '/' || pathname === '/index.html') return serveDocument(source);
  // An uploaded view carries everything inline, and a file is only its bytes:
  // their origins serve nothing else.
  if (source.kind === 'snapshot' || source.kind === 'file') {
    return artifactPageError(404, 'Not found', source.pageId);
  }
  if (pathname.startsWith(HOST_ASSET_PREFIX)) return serveHostAsset(source, pathname, runtimeDir);
  return serveAuthoredAsset(source, pathname);
}
