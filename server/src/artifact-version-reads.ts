import { and, desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from './db/client.js';
import {
  artifacts,
  artifactVersionFiles,
  artifactVersions,
  artifactVersionViews,
} from './db/schema-artifacts.js';
import { users } from './db/schema.js';

/**
 * Reads over artifact_versions and their views (P6 viewing model, design
 * the P6 sharing design §9), shared by the versions
 * routes, the view route and the public link.
 */

/**
 * Who saved a version, named as people are everywhere else in the app: their
 * profile name, read when the version is, so a rename shows too. The email the
 * save stamped (`author_name`) answers only for an account without a name —
 * "saved just now by asha@example.com" stood where the app says
 * "Asha Rao" (devstation-ale). Every read using it joins the saver's
 * account with `versionAuthorJoin`.
 */
const versionAuthorName = sql<
  string | null
>`coalesce(${users.name}, ${artifactVersions.author_name})`;
export const versionAuthorJoin = eq(users.id, artifactVersions.author_id);

// A page version's source can be as large as the page itself; it is served
// only by the snapshot endpoint, never in list or metadata reads.
const {
  content: _pageSource,
  author_name: _savedAuthorName,
  ...versionColumns
} = getTableColumns(artifactVersions);
export const versionMetadataColumns = { ...versionColumns, author_name: versionAuthorName };

/** Triggers a public link publishes for a document (decision 3): never 'auto'. */
const PUBLISHED_TRIGGERS = ['manual', 'agent_milestone'];

export type VersionMetadata = Omit<typeof artifactVersions.$inferSelect, 'content'> & {
  has_view: boolean;
};

/** One version's metadata, as a save answers with it. */
export async function selectVersionMetadata(versionId: string): Promise<VersionMetadata> {
  const [row] = await db
    .select({ ...versionMetadataColumns, view_version_id: artifactVersionViews.version_id })
    .from(artifactVersions)
    .leftJoin(users, versionAuthorJoin)
    .leftJoin(artifactVersionViews, eq(artifactVersionViews.version_id, artifactVersions.id))
    .where(eq(artifactVersions.id, versionId))
    .limit(1);
  if (!row) throw new Error(`[versions] version vanished after its save: ${versionId}`);
  const { view_version_id, ...metadata } = row;
  return { ...metadata, has_view: view_version_id !== null };
}

export interface ArtifactView {
  version_id: string;
  version_number: number;
  trigger: string;
  author_name: string | null;
  created_at: Date;
  html: string;
}

/**
 * The view of `versionId`, or of the artifact's latest version that has one.
 * Scoped by artifact AND work item, so a version id can never reach another
 * artifact's view. null when there is none.
 */
export async function selectArtifactView(
  artifactId: string,
  workItemId: string,
  versionId: string | null
): Promise<ArtifactView | null> {
  const conditions: SQL[] = [eq(artifacts.id, artifactId), eq(artifacts.work_item_id, workItemId)];
  if (versionId !== null) conditions.push(eq(artifactVersions.id, versionId));
  const [view] = await db
    .select({
      version_id: artifactVersions.id,
      version_number: artifactVersions.version_number,
      trigger: artifactVersions.trigger,
      author_name: versionAuthorName,
      created_at: artifactVersions.created_at,
      html: artifactVersionViews.html,
    })
    .from(artifactVersionViews)
    .innerJoin(artifactVersions, eq(artifactVersions.id, artifactVersionViews.version_id))
    .leftJoin(users, versionAuthorJoin)
    .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifact_id))
    .where(and(...conditions))
    .orderBy(desc(artifactVersions.version_number))
    .limit(1);
  return view ?? null;
}

export interface ArtifactFile {
  version_id: string;
  version_number: number;
  trigger: string;
  author_name: string | null;
  created_at: Date;
  mime_type: string;
  byte_size: number;
  content_base64: string;
}

/**
 * The bytes of a file artifact's `versionId`, or of its latest version that
 * still has them (P6 §10). Scoped by artifact AND work item like
 * selectArtifactView. null when there is none.
 */
export async function selectArtifactFile(
  artifactId: string,
  workItemId: string,
  versionId: string | null
): Promise<ArtifactFile | null> {
  const conditions: SQL[] = [eq(artifacts.id, artifactId), eq(artifacts.work_item_id, workItemId)];
  if (versionId !== null) conditions.push(eq(artifactVersions.id, versionId));
  const [file] = await db
    .select({
      version_id: artifactVersions.id,
      version_number: artifactVersions.version_number,
      trigger: artifactVersions.trigger,
      author_name: versionAuthorName,
      created_at: artifactVersions.created_at,
      mime_type: artifactVersionFiles.mime_type,
      byte_size: artifactVersionFiles.byte_size,
      content_base64: artifactVersionFiles.content_base64,
    })
    .from(artifactVersionFiles)
    .innerJoin(artifactVersions, eq(artifactVersions.id, artifactVersionFiles.version_id))
    .leftJoin(users, versionAuthorJoin)
    .innerJoin(artifacts, eq(artifacts.id, artifactVersions.artifact_id))
    .where(and(...conditions))
    .orderBy(desc(artifactVersions.version_number))
    .limit(1);
  return file ?? null;
}

/** The MIME type of a file artifact's latest stored bytes — without reading them. */
export async function selectLatestFileMimeType(artifactId: string): Promise<string | null> {
  const [row] = await db
    .select({ mime_type: artifactVersionFiles.mime_type })
    .from(artifactVersionFiles)
    .innerJoin(artifactVersions, eq(artifactVersions.id, artifactVersionFiles.version_id))
    .where(eq(artifactVersions.artifact_id, artifactId))
    .orderBy(desc(artifactVersions.version_number))
    .limit(1);
  return row?.mime_type ?? null;
}

/** Whether any version of the artifact still has a view — without reading it. */
export async function hasArtifactView(artifactId: string): Promise<boolean> {
  const [row] = await db
    .select({ version_id: artifactVersionViews.version_id })
    .from(artifactVersionViews)
    .innerJoin(artifactVersions, eq(artifactVersions.id, artifactVersionViews.version_id))
    .where(eq(artifactVersions.artifact_id, artifactId))
    .limit(1);
  return row !== undefined;
}

/** A document's latest `manual` or `agent_milestone` version — what its public link shows. */
export async function selectLatestPublishedVersion(
  artifactId: string
): Promise<{ id: string; document_name: string } | null> {
  const [version] = await db
    .select({ id: artifactVersions.id, document_name: artifactVersions.document_name })
    .from(artifactVersions)
    .where(
      and(
        eq(artifactVersions.artifact_id, artifactId),
        inArray(artifactVersions.trigger, PUBLISHED_TRIGGERS)
      )
    )
    .orderBy(desc(artifactVersions.version_number))
    .limit(1);
  return version ?? null;
}
