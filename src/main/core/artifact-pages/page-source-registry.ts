import { createHash } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
import { artifactTypeForPath } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';
import {
  findWorkItemRepoPath,
  resolveStoredArtifactPath,
} from '@main/core/artifacts/artifact-file-path';
import { getArtifact } from '@main/core/artifacts/getArtifact';
import { confineToCheckout } from '@main/core/work-items/repo-file-path';
import { isPathInside } from './path-containment';

/** What kind of document a page origin serves at `/`. */
export type PageSourceKind = 'html' | 'mdx' | 'prototype' | 'snapshot' | 'file';

/** A page built from a file in the work item's repository (or a stored version of it). */
export interface FilePageSource {
  /** The host part of `chord-artifact://<pageId>/…`. */
  pageId: string;
  kind: 'html' | 'mdx' | 'prototype';
  /** Absolute path of the file the page is built from, already translated. */
  filePath: string;
  workItemId: string;
  /**
   * Directories a page's imports and relative assets may come from: the work
   * item's repository and the entry file's own directory. Anything the
   * bundler resolves outside these is a build error, never inlined.
   */
  allowedRoots: string[];
  /**
   * Source text to serve or compile instead of reading `filePath` — a stored
   * version of the page. Relative imports and assets still resolve against
   * `filePath`'s directory.
   */
  inlineSource?: string;
}

/**
 * The self-contained view of a page version uploaded by its author, fetched
 * from the cloud (design 2026-09-24 §9 "Desktop contract"). Served verbatim
 * at `/`; it has no authored assets and needs no host assets.
 */
export interface SnapshotPageSource {
  pageId: string;
  kind: 'snapshot';
  html: string;
}

/**
 * A binary artifact's bytes — a pdf, framed without the `sandbox` attribute
 * because Chromium's PDF viewer is blocked inside one (design 2026-09-24 §10).
 * Served verbatim at `/` under the same isolation headers as every page.
 */
export interface FileBytesPageSource {
  pageId: string;
  kind: 'file';
  bytes: Buffer;
  mimeType: string;
}

export type PageSource = FilePageSource | SnapshotPageSource | FileBytesPageSource;

/** The artifact row does not exist or has no file — the only "missing" case. */
export class ArtifactPageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactPageNotFoundError';
  }
}

/**
 * The set of page origins main is willing to serve. A URL whose host is not
 * registered here is a 404 before any disk access happens: the protocol never
 * turns an arbitrary id into a path. Rows are registered on demand when the
 * renderer asks to open a page, and the map is per app run — nothing persists.
 */
const sources = new Map<string, PageSource>();

function kindForArtifactType(type: ArtifactType, filePath: string): FilePageSource['kind'] {
  if (type === 'web') return 'html';
  if (type === 'prototype') return 'prototype';
  // Legacy rows created before `mdx` was a content type carry `markdown`
  // with an `.mdx` path (use-artifact-content.ts has the same check).
  if (type === 'mdx' || filePath.toLowerCase().endsWith('.mdx')) return 'mdx';
  throw new Error(`Artifact type '${type}' is not a page`);
}

function allowedRootsFor(workItemId: string, filePath: string): string[] {
  const roots = [dirname(filePath)];
  const repoPath = findWorkItemRepoPath(workItemId);
  if (repoPath) roots.unshift(repoPath);
  return roots;
}

/** Hostname labels are limited to 63 characters; a digest keeps every id short. */
function digestPageId(prefix: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32);
  return `${prefix}-${digest}`;
}

function register<T extends PageSource>(source: T): T {
  sources.set(source.pageId, source);
  return source;
}

/**
 * The page a file would be served as, without registering an origin for it —
 * what the view of a version is built from (build-page-snapshot.ts), even
 * before the artifact row exists. `inlineSource` is the version's text.
 */
export function describeFilePageSource(args: {
  pageId: string;
  type: ArtifactType;
  filePath: string;
  workItemId: string;
  inlineSource?: string;
}): FilePageSource {
  return {
    pageId: args.pageId.toLowerCase(),
    kind: kindForArtifactType(args.type, args.filePath),
    filePath: args.filePath,
    workItemId: args.workItemId,
    allowedRoots: allowedRootsFor(args.workItemId, args.filePath),
    inlineSource: args.inlineSource,
  };
}

/** A page whose origin is the artifact row itself: `chord-artifact://<artifactId>/`. */
export async function registerArtifactPageSource(artifactId: string): Promise<FilePageSource> {
  const artifact = await getArtifact(artifactId);
  if (!artifact) throw new ArtifactPageNotFoundError(`Artifact not found: ${artifactId}`);
  if (!artifact.filePath) {
    throw new ArtifactPageNotFoundError(`Artifact ${artifactId} has no file to serve`);
  }
  return register(
    describeFilePageSource({
      pageId: artifactId,
      type: artifact.type as ArtifactType,
      filePath: artifact.filePath,
      workItemId: artifact.workItemId,
    })
  );
}

/**
 * A stored version of a page, served from the version's source text at its
 * own origin so previewing v3 never touches what v5 has on disk. The origin is
 * content-addressed: the same version always maps to the same page id.
 */
export async function registerArtifactVersionSource(args: {
  artifactId: string;
  versionId: string;
  content: string;
}): Promise<FilePageSource> {
  const current = await registerArtifactPageSource(args.artifactId);
  return register({
    ...current,
    pageId: digestPageId('ver', args.artifactId, args.versionId, args.content),
    inlineSource: args.content,
  });
}

/**
 * One component of an MDX artifact compiled on its own — its source is the
 * file's imports and exports plus that one block (Confluence snapshots, P5).
 * Content-addressed like a version, and resolved against the artifact's file.
 */
export async function registerArtifactSnippetSource(args: {
  artifactId: string;
  source: string;
}): Promise<FilePageSource> {
  const current = await registerArtifactPageSource(args.artifactId);
  if (current.kind !== 'mdx') {
    throw new Error(`Artifact ${args.artifactId} is not a rich document; it has no components`);
  }
  return register({
    ...current,
    pageId: digestPageId('snip', args.artifactId, args.source),
    inlineSource: args.source,
  });
}

/**
 * An `.mdx` component embedded in a document via `<mdx-component data-path>`
 * has no artifact row of its own (the prose protocol that creates those tags is
 * removed in P2). Until then its origin is derived from the path, and the path
 * must sit inside the work item's repository — the only directory the agent
 * wrote to — so a document cannot point the bundler at an arbitrary file.
 */
export function registerEmbeddedMdxSource(args: {
  filePath: string;
  workItemId: string;
}): FilePageSource {
  const repoPath = findWorkItemRepoPath(args.workItemId);
  if (!repoPath) throw new Error(`Work item not found: ${args.workItemId}`);
  const filePath = resolveStoredArtifactPath(args.filePath, args.workItemId);
  if (!isAbsolute(filePath))
    throw new Error(`MDX component path must be absolute: ${args.filePath}`);
  if (!filePath.toLowerCase().endsWith('.mdx')) {
    throw new Error(`Embedded component must be an .mdx file: ${args.filePath}`);
  }
  if (!isPathInside(repoPath, filePath)) {
    throw new Error(`MDX component path is outside the work item repository: ${args.filePath}`);
  }
  return register({
    pageId: digestPageId('mdx', args.workItemId, filePath.toLowerCase()),
    kind: 'mdx',
    filePath,
    workItemId: args.workItemId,
    allowedRoots: [repoPath],
  });
}

/**
 * A repo file that is no artifact, previewed as the page it is (design
 * 2026-09-26 §3): `.html`, `.tsx`/`.jsx`, `.mdx`. Its origin is keyed by the
 * file, so reopening it reuses the origin; imports resolve inside the
 * checkout only.
 */
export function registerRepoFilePageSource(args: {
  workItemId: string;
  checkoutPath: string;
  filePath: string;
}): FilePageSource {
  const absolute = confineToCheckout(args.checkoutPath, args.filePath);
  if (absolute === null) {
    throw new Error(`${args.filePath} is outside the work item's checkout`);
  }
  const type = artifactTypeForPath(args.filePath);
  const kind: FilePageSource['kind'] | null =
    type === 'web' ? 'html' : type === 'prototype' ? 'prototype' : type === 'mdx' ? 'mdx' : null;
  if (kind === null) throw new Error(`${args.filePath} is not a page`);
  return register({
    pageId: digestPageId('repo', args.workItemId, absolute.toLowerCase()),
    kind,
    filePath: absolute,
    workItemId: args.workItemId,
    allowedRoots: [args.checkoutPath],
  });
}

/**
 * A version's uploaded view, at an origin of its own. One version is one
 * immutable view, so the origin is derived from the version and reused.
 */
export function registerSnapshotPageSource(args: {
  artifactId: string;
  versionId: string;
  html: string;
}): SnapshotPageSource {
  return register({
    pageId: digestPageId('snap', args.artifactId, args.versionId),
    kind: 'snapshot',
    html: args.html,
  });
}

/**
 * One version of a file's bytes, at an origin of its own. `versionKey` names
 * the version — a version id, or a digest of the bytes for a file as it is on
 * disk now — so a changed file never reuses an origin.
 */
export function registerFileBytesPageSource(args: {
  artifactId: string;
  versionKey: string;
  bytes: Buffer;
  mimeType: string;
}): FileBytesPageSource {
  return register({
    pageId: digestPageId('file', args.artifactId, args.versionKey),
    kind: 'file',
    bytes: args.bytes,
    mimeType: args.mimeType,
  });
}

export function findPageSource(pageId: string): PageSource | undefined {
  return sources.get(pageId.toLowerCase());
}

/** Tests only — the registry is process-global. */
export function clearPageSourcesForTest(): void {
  sources.clear();
}
