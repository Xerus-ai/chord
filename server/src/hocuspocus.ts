import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Server } from '@hocuspocus/server';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { resolveArtifactAccess, type AccessRole } from './access/resolve-access.js';
import {
  insertVersionRow,
  scheduleAutoVersionPrune,
  type VersionInsertResult,
  type VersionTrigger,
} from './artifact-version-rows.js';
import { db, hasDb } from './db/client.js';
import { artifacts, artifactVersionSnapshots, yjsDocuments } from './db/schema-artifacts.js';
import { DEV_MODE, verifyAccessToken, type AuthClaims } from './middleware/auth.js';

export interface HocuspocusContext {
  user: AuthClaims;
}

// server/data/hocuspocus/*.yjs is no longer the source of truth when hasDb —
// it now only serves two roles: (1) the entire persistence story in no-DB
// dev mode, and (2) a one-time lazy-import source for documents written
// before ARCH-3a. Both still need these paths and the atomic-write helper.
const DATA_DIR = join(process.cwd(), 'data', 'hocuspocus');
const VERSIONS_DIR = join(DATA_DIR, 'versions');
const AUTO_SAVE_INTERVAL = 10;

interface DocumentStoreState {
  count: number;
  lastHash: string | null;
}

const documentStoreState = new Map<string, DocumentStoreState>();

function docPath(documentName: string): string {
  const safe = documentName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(DATA_DIR, `${safe}.yjs`);
}

export function versionPath(documentName: string, versionId: string): string {
  const safe = documentName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(VERSIONS_DIR, safe, `${versionId}.yjs`);
}

// Plain writeFile leaves a truncated/partial file on disk if the process dies
// mid-write (crash, OOM, container kill) — the next read would then hand a
// corrupt update to Yjs. Writing to a temp file in the same directory and
// renaming over the target is atomic on both POSIX and Windows (NTFS), so
// readers only ever see the old complete file or the new complete file.
async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, data);
  await rename(tempPath, path);
}

async function readDiskIfExists(path: string): Promise<Uint8Array | null> {
  if (!existsSync(path)) return null;
  return new Uint8Array(await readFile(path));
}

// Applies bytes to a throwaway doc before they're trusted, regardless of
// whether they came from Postgres or a legacy disk file — corruption can
// originate from either source. Fails loudly with the document and source
// identified rather than letting a corrupted buffer poison a live doc or
// silently becoming an empty one, which would look like data loss to every
// collaborator on the artifact.
function validateUpdateOrThrow(update: Uint8Array, documentName: string, source: string): void {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
  } catch (err) {
    probe.destroy();
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hocuspocus] corrupted document from ${source}: ${documentName}: ${message}`);
    throw new Error(`Corrupted Yjs document for ${documentName} (${source}): ${message}`);
  }
  probe.destroy();
}

async function upsertYjsDocument(documentName: string, update: Uint8Array): Promise<void> {
  const state = Buffer.from(update).toString('base64');
  await db
    .insert(yjsDocuments)
    .values({ document_name: documentName, state })
    .onConflictDoUpdate({
      target: yjsDocuments.document_name,
      set: { state, updated_at: new Date() },
    });
}

async function selectYjsDocumentState(documentName: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ state: yjsDocuments.state })
    .from(yjsDocuments)
    .where(eq(yjsDocuments.document_name, documentName))
    .limit(1);
  return row ? new Uint8Array(Buffer.from(row.state, 'base64')) : null;
}

async function upsertVersionSnapshot(versionId: string, update: Uint8Array): Promise<void> {
  const snapshot = Buffer.from(update).toString('base64');
  await db
    .insert(artifactVersionSnapshots)
    .values({ version_id: versionId, snapshot })
    .onConflictDoUpdate({ target: artifactVersionSnapshots.version_id, set: { snapshot } });
}

async function selectVersionSnapshot(versionId: string): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ snapshot: artifactVersionSnapshots.snapshot })
    .from(artifactVersionSnapshots)
    .where(eq(artifactVersionSnapshots.version_id, versionId))
    .limit(1);
  return row ? new Uint8Array(Buffer.from(row.snapshot, 'base64')) : null;
}

/**
 * Reads the live document state: Postgres first when hasDb, falling back to
 * a one-time lazy import of the legacy on-disk copy if the DB has no row yet
 * (pre-ARCH-3a data, or any doc written before a DB was configured). The
 * disk file is left in place — never deleted — as a backup. In no-DB dev
 * mode, disk is the entire persistence story, not a fallback from Postgres.
 * Idempotent under concurrent import races (multi-node first-load of the
 * same document): the upsert is keyed on document_name, so two nodes
 * importing the same unchanged disk bytes simultaneously just write the same
 * row twice — safe, no locking required. Returns null only when no state
 * exists anywhere (brand-new document).
 */
export async function readDocumentState(documentName: string): Promise<Uint8Array | null> {
  if (!hasDb) {
    const diskUpdate = await readDiskIfExists(docPath(documentName));
    if (diskUpdate)
      validateUpdateOrThrow(diskUpdate, documentName, `disk (${docPath(documentName)})`);
    return diskUpdate;
  }

  const dbUpdate = await selectYjsDocumentState(documentName);
  if (dbUpdate) {
    validateUpdateOrThrow(dbUpdate, documentName, 'database');
    return dbUpdate;
  }

  const path = docPath(documentName);
  const diskUpdate = await readDiskIfExists(path);
  if (!diskUpdate) return null;

  validateUpdateOrThrow(diskUpdate, documentName, `disk (${path})`);
  console.log(`[hocuspocus] importing legacy disk document into Postgres: ${documentName}`);
  await upsertYjsDocument(documentName, diskUpdate);
  return diskUpdate;
}

/** Same DB-first, lazy-import-from-disk, never-delete-the-backup story as
 * readDocumentState, scoped to one version's snapshot bytes. */
export async function readVersionSnapshot(
  documentName: string,
  versionId: string
): Promise<Uint8Array | null> {
  const path = versionPath(documentName, versionId);

  if (!hasDb) {
    const diskSnapshot = await readDiskIfExists(path);
    if (diskSnapshot) validateUpdateOrThrow(diskSnapshot, documentName, `disk (${path})`);
    return diskSnapshot;
  }

  const dbSnapshot = await selectVersionSnapshot(versionId);
  if (dbSnapshot) {
    validateUpdateOrThrow(dbSnapshot, documentName, `database (version ${versionId})`);
    return dbSnapshot;
  }

  const diskSnapshot = await readDiskIfExists(path);
  if (!diskSnapshot) return null;

  validateUpdateOrThrow(diskSnapshot, documentName, `disk (${path})`);
  console.log(`[hocuspocus] importing legacy disk version snapshot into Postgres: ${versionId}`);
  await upsertVersionSnapshot(versionId, diskSnapshot);
  return diskSnapshot;
}

/**
 * Versions a document artifact from Yjs state. The row and its snapshot are
 * written in one batch by insertVersionRow, so a version never exists without
 * its snapshot.
 */
export async function saveVersionSnapshot(version: {
  documentName: string;
  update: Uint8Array;
  authorId: string | null;
  authorName: string | null;
  trigger: VersionTrigger;
  label: string | null;
  /** The version a manual save was made on; null for automatic snapshots. */
  baseVersion: number | null;
  /** The uploading client's id for this version; null for server-made versions. */
  clientVersionId: string | null;
}): Promise<VersionInsertResult> {
  const { documentName, update, trigger } = version;
  const artifactId = documentName.replace(/^artifact-/, '');
  const versionId = randomUUID();

  if (!hasDb) {
    // No-DB dev mode: disk is the entire persistence story — there is no DB
    // row possible without a DB, so nothing to insert below. The versions
    // route answers 503 in this mode, so no based save reaches here.
    const versionDir = join(VERSIONS_DIR, documentName.replace(/[^a-zA-Z0-9_-]/g, '_'));
    await mkdir(versionDir, { recursive: true });
    await writeFileAtomic(join(versionDir, `${versionId}.yjs`), update);
    return { status: 'saved', versionId };
  }

  const inserted = await insertVersionRow({
    id: versionId,
    artifactId,
    documentName,
    authorId: version.authorId,
    authorName: version.authorName,
    label: version.label,
    byteSize: update.byteLength,
    trigger,
    content: null,
    baseVersion: version.baseVersion,
    clientVersionId: version.clientVersionId,
    attachment: { kind: 'snapshot', update },
  });

  if (inserted.status === 'saved' && trigger === 'auto') {
    scheduleAutoVersionPrune(artifactId, documentName);
  }
  return inserted;
}

export const ARTIFACT_DOC_PREFIX = 'artifact-';

/**
 * Per-document authorization through the one access resolver
 * (access/resolve-access.ts): artifact access, inherited from the work item
 * or granted on the artifact alone. Fail-closed — unknown namespaces and
 * unregistered artifacts are denied, and so is every artifact that is not a
 * document — pages and files (render_class 'page' | 'file') never get a Yjs
 * room. Returns the role so the
 * caller puts 'view' connections into read-only mode — this socket is the
 * actual content-editing surface.
 */
export async function resolveDocumentAccess(
  claims: AuthClaims,
  documentName: string
): Promise<AccessRole> {
  if (DEV_MODE) return 'author';

  if (!documentName.startsWith(ARTIFACT_DOC_PREFIX)) {
    throw new Error(`Unknown document namespace: ${documentName}`);
  }

  const artifactId = documentName.slice(ARTIFACT_DOC_PREFIX.length);
  const [artifact] = await db
    .select({ render_class: artifacts.render_class })
    .from(artifacts)
    .where(eq(artifacts.id, artifactId))
    .limit(1);

  if (!artifact) {
    throw new Error(`Unknown artifact: ${artifactId}`);
  }

  if (artifact.render_class === 'page') {
    throw new Error(`Page artifacts have no collaboration document: ${documentName}`);
  }
  if (artifact.render_class !== 'document') {
    throw new Error(`Only document artifacts have a collaboration document: ${documentName}`);
  }

  const access = await resolveArtifactAccess(claims.userId, artifactId);
  if (access === null || access === 'not_found') {
    throw new Error(`Access denied to document ${documentName}`);
  }

  return access.role;
}

export function createHocuspocusServer(port: number) {
  const server = new Server<HocuspocusContext>({
    port,
    quiet: true,

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const claims = await verifyAccessToken(token);
      const role = await resolveDocumentAccess(claims, documentName);
      // 'view' still gets sync (read access to live content) but Hocuspocus
      // will reject any update the client tries to apply.
      if (role === 'view') {
        connectionConfig.readOnly = true;
      }
      return { user: claims };
    },

    async onLoadDocument({ documentName }) {
      const update = await readDocumentState(documentName);
      return update ?? undefined;
    },

    async onStoreDocument({ documentName, document }) {
      const update = Y.encodeStateAsUpdate(document);
      const state = documentStoreState.get(documentName) ?? { count: 0, lastHash: null };

      if (!hasDb) {
        // No-DB dev mode: disk is the entire persistence story, not a
        // fallback from Postgres — there is nothing to fall back from when
        // DATABASE_URL isn't configured. Always writes; the unchanged-bytes
        // skip below only guards the Postgres round trip.
        await mkdir(DATA_DIR, { recursive: true });
        await writeFileAtomic(docPath(documentName), update);
      } else {
        const hash = createHash('sha256').update(update).digest('hex');
        if (state.lastHash !== hash) {
          // Throws loudly on a genuine DB error (network blip, Neon
          // outage) — Hocuspocus's own storeDocumentHooks catch keeps the
          // document in memory and retries on the next debounce tick; this
          // must never silently degrade to writing the local (and, on a
          // deploy without a mounted volume, ephemeral) disk path instead.
          await upsertYjsDocument(documentName, update);
          state.lastHash = hash;
        }
      }

      state.count += 1;
      documentStoreState.set(documentName, state);

      if (state.count % AUTO_SAVE_INTERVAL === 0) {
        // Reuse the update already encoded above instead of re-encoding the
        // same document state a second time.
        await saveVersionSnapshot({
          documentName,
          update,
          authorId: null,
          authorName: null,
          trigger: 'auto',
          label: null,
          baseVersion: null,
          clientVersionId: null,
        });
      }
    },

    // Fires once a document has no open connections and its debounced store
    // has settled (Hocuspocus's own shouldUnloadDocument gate) — the memory
    // side of the document's lifecycle is over. Without this, documentStoreState
    // keeps one entry per artifact ever opened for the life of the process.
    async afterUnloadDocument({ documentName }) {
      documentStoreState.delete(documentName);
    },
  });

  return server;
}

// The live server, exposed for hocuspocus-connections.ts (forced disconnects).
let activeHocuspocus: Server<HocuspocusContext> | null = null;

export function getActiveHocuspocus(): Server<HocuspocusContext> | null {
  return activeHocuspocus;
}

/**
 * The document as it stands now, for snapshotting a version. While this
 * process's Hocuspocus has the document loaded, its in-memory Y.Doc is the
 * authoritative state — the stored copy trails it by the store debounce (up
 * to maxDebounce), so a "Save version" right after typing would drop those
 * edits. Hocuspocus adds a document to its map only once onLoadDocument has
 * finished and removes it on unload, after the final store, so a document
 * that is not in the map is fully described by the stored state. Readers
 * that want the stored copy itself use readDocumentState.
 */
export async function readCurrentDocumentState(documentName: string): Promise<Uint8Array | null> {
  const loaded = activeHocuspocus?.hocuspocus.documents.get(documentName);
  if (loaded) return Y.encodeStateAsUpdate(loaded);
  return readDocumentState(documentName);
}

export async function startHocuspocusServer(port: number) {
  const server = createHocuspocusServer(port);
  await server.listen();
  activeHocuspocus = server;
  console.log(`[hocuspocus] listening on port ${port}`);
  return server;
}
