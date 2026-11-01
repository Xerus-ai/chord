import { readFile } from 'node:fs/promises';
import { isLiveDocumentType, type ConfluencePublicationStatus } from '@shared/confluence';
import type { ArtifactType } from '@shared/stream-items';
import { getArtifact } from '@main/core/artifacts/getArtifact';
import { resolveArtifactAuthorName } from '@main/core/artifacts/save-artifact-version';
import { appSettingsService } from '@main/core/settings/settings-service';
import { buildConfluenceBody, type PublishArtifactSource } from './build-confluence-body';
import {
  createPage,
  fetchPage,
  findSpaceByKey,
  updatePage,
  uploadAttachment,
  type ConfluenceAuth,
} from './confluence-client';
import { requireConfluenceAuth } from './confluence-connection';
import {
  describePublicationState,
  ensurePublishedVersion,
  findPublication,
  readPublishedContent,
  recordPublication,
} from './publication-records';
import { runPublishExclusively, waitForPublishInFlight } from './publish-queue';
import { readTeamPublishingPolicy } from './read-team-publishing-policy';
import { assertTeamAllowsConfluencePublishing } from './team-publishing-policy';

/** The page was edited in Confluence after Chord last wrote it; updating would overwrite that. */
export class EditedInConfluenceError extends Error {
  constructor(readonly status: ConfluencePublicationStatus) {
    super(
      'This page was edited in Confluence since Chord last published it. Publishing again replaces those edits.'
    );
    this.name = 'EditedInConfluenceError';
  }
}

async function loadArtifact(artifactId: string): Promise<PublishArtifactSource> {
  const artifact = await getArtifact(artifactId);
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
  if (!artifact.filePath)
    throw new Error(`${artifact.name} has no file, so it cannot be published.`);
  return {
    id: artifact.id,
    workItemId: artifact.workItemId,
    name: artifact.name,
    type: artifact.type as ArtifactType,
    filePath: artifact.filePath,
  };
}

async function resolveTargetSpaceId(auth: ConfluenceAuth): Promise<{ id: string; key: string }> {
  const { confluenceDefaultSpaceKey } = await appSettingsService.get('artifacts');
  if (!confluenceDefaultSpaceKey) {
    throw new Error('Choose a default Confluence space in Settings › Agents › Artifacts first.');
  }
  const space = await findSpaceByKey(auth, confluenceDefaultSpaceKey);
  return { id: space.id, key: space.key };
}

/**
 * Publishes an artifact to Confluence: the first publish creates a page in
 * the default space, every later one updates that same page. The content is
 * saved as an artifact version first, so "Published vN" names a version the
 * History tab shows. A page someone edited in Confluence is not overwritten
 * unless `overwriteRemoteEdits` says the person chose to.
 */
export function publishArtifactToConfluence(input: {
  artifactId: string;
  documentHtml?: string;
  overwriteRemoteEdits?: boolean;
}): Promise<ConfluencePublicationStatus> {
  return runPublishExclusively(input.artifactId, () => publishNow(input));
}

async function publishNow(input: {
  artifactId: string;
  documentHtml?: string;
  overwriteRemoteEdits?: boolean;
}): Promise<ConfluencePublicationStatus> {
  // Every publish starts here (the Publish tab, the automatic update): the
  // team's policy is read before anything is sent.
  assertTeamAllowsConfluencePublishing(await readTeamPublishingPolicy());
  const artifact = await loadArtifact(input.artifactId);
  const auth = await requireConfluenceAuth();
  const authorName = await resolveArtifactAuthorName();
  if (!authorName)
    throw new Error('Sign in to Chord — a publish is saved as a version attributed to you.');

  const existing = findPublication(artifact.id);
  if (existing && !input.overwriteRemoteEdits) {
    const remote = await fetchPage(auth, existing.pageId);
    if (remote.version > existing.confluenceVersion) {
      throw new EditedInConfluenceError(
        describePublicationState({
          publication: existing,
          siteUrl: auth.siteUrl,
          remoteVersion: remote.version,
          currentContent: '',
          publishedContent: '',
        })
      );
    }
  }

  const body = await buildConfluenceBody(artifact, input.documentHtml);
  const { storage, attachments } = await body.render();
  const publishedArtifactVersion = ensurePublishedVersion({
    artifactId: artifact.id,
    content: body.content,
    authorName,
  });

  let pageId: string;
  let spaceKey: string;
  if (existing) {
    pageId = existing.pageId;
    spaceKey = existing.spaceKey;
    for (const attachment of attachments) await uploadAttachment(auth, pageId, attachment);
    // Read after the uploads: the next version is relative to the page as it is now.
    const current = await fetchPage(auth, pageId);
    await updatePage(auth, {
      pageId,
      title: artifact.name,
      storage,
      nextVersion: current.version + 1,
    });
  } else {
    const space = await resolveTargetSpaceId(auth);
    const page = await createPage(auth, { spaceId: space.id, title: artifact.name, storage });
    pageId = page.id;
    spaceKey = space.key;
    for (const attachment of attachments) await uploadAttachment(auth, pageId, attachment);
  }

  // Recorded as Confluence reports it after every write, so attachment
  // uploads never read back as someone else's edit.
  const settled = await fetchPage(auth, pageId);
  const publication = recordPublication({
    artifactId: artifact.id,
    spaceKey,
    pageId,
    confluenceVersion: settled.version,
    publishedArtifactVersion,
  });
  return describePublicationState({
    publication,
    siteUrl: auth.siteUrl,
    remoteVersion: settled.version,
    currentContent: body.content,
    publishedContent: body.content,
  });
}

/**
 * The artifact's status now. A document is compared by its live content,
 * which only the caller's editor holds; other formats by their file.
 */
export async function readConfluenceStatus(input: {
  artifactId: string;
  documentHtml?: string;
}): Promise<ConfluencePublicationStatus> {
  // Mid-publish, the page is ahead of the record; read once the record catches up.
  await waitForPublishInFlight(input.artifactId);
  const publication = findPublication(input.artifactId);
  if (!publication) return { state: 'unpublished' };
  const artifact = await loadArtifact(input.artifactId);
  const auth = await requireConfluenceAuth();
  const remote = await fetchPage(auth, publication.pageId);

  let currentContent: string;
  if (isLiveDocumentType(artifact.type)) {
    if (input.documentHtml === undefined) {
      throw new Error('A document is compared by its live content; pass the editor HTML.');
    }
    currentContent = input.documentHtml;
  } else {
    currentContent = await readFile(artifact.filePath, 'utf-8');
  }
  return describePublicationState({
    publication,
    siteUrl: auth.siteUrl,
    remoteVersion: remote.version,
    currentContent,
    publishedContent: readPublishedContent(artifact.id, publication.publishedArtifactVersion),
  });
}
