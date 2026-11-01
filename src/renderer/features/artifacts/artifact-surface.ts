import type { PageMode } from '@shared/artifact-frame-constants';
import type { ArtifactRenderClass } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';

/**
 * Where an artifact tab reads the artifact from (design 2026-09-24 §9):
 * `local` is the author's own copy on this device; `cloud` is the server's
 * copy, for teammates, artifact-only members and the author elsewhere.
 * Hosts pass it explicitly — a missing local row never implies `cloud`.
 */
export type ArtifactSource = 'local' | 'cloud';

/** The caller's access to an artifact, as `GET /artifacts/:id` reports it. */
export type ArtifactAccessRole = 'view' | 'edit' | 'author';

export type ArtifactSurfaceInput =
  | { source: 'local'; renderClass: ArtifactRenderClass; artifactType: ArtifactType }
  | {
      source: 'cloud';
      renderClass: ArtifactRenderClass;
      artifactType: ArtifactType;
      callerRole: ArtifactAccessRole;
    };

/** Which parts of an artifact tab exist for one source, format and role. */
export interface ArtifactSurface {
  /** The "file changed on disk" notice — only a local file can drift. */
  showDriftNotice: boolean;
  readOnly: boolean;
  /** Page modes the toolbar offers; empty for documents. */
  pageModes: PageMode[];
  /** Agent file writes flow into the editor (author's device only). */
  pushAgentContent: boolean;
  /** The editor seeds an empty document from the artifact file. */
  seedFromFile: boolean;
  versions: ArtifactSource;
  /** Where "Save version" writes, or null when this tab cannot save one. */
  saveVersion: ArtifactSource | null;
  /** Where a page's frame comes from; null for non-pages. */
  pageFrame: ArtifactSource | null;
  /** Where a binary file's bytes come from (design §10); null for non-files. */
  fileView: ArtifactSource | null;
  showConfluencePublish: boolean;
}

function localPageModes(artifactType: ArtifactType): PageMode[] {
  return artifactType === 'web' ? ['view', 'edit-text', 'pick'] : ['view', 'pick'];
}

export function resolveArtifactSurface(input: ArtifactSurfaceInput): ArtifactSurface {
  const isPage = input.renderClass === 'page';
  const isDocument = input.renderClass === 'document';

  // A file (§10) is read-only everywhere: no editor, no seed, no agent push and
  // no manual save — it changes only when it is rewritten and republished.
  if (input.renderClass === 'file') {
    return {
      showDriftNotice: input.source === 'local',
      readOnly: true,
      pageModes: [],
      pushAgentContent: false,
      seedFromFile: false,
      versions: input.source,
      saveVersion: null,
      pageFrame: null,
      fileView: input.source,
      showConfluencePublish: false,
    };
  }

  if (input.source === 'local') {
    return {
      showDriftNotice: true,
      readOnly: false,
      pageModes: isPage ? localPageModes(input.artifactType) : [],
      pushAgentContent: isDocument,
      seedFromFile: isDocument,
      versions: 'local',
      saveVersion: 'local',
      pageFrame: isPage ? 'local' : null,
      fileView: null,
      showConfluencePublish: true,
    };
  }

  // A cloud page is the author's uploaded view: nothing here can change it,
  // and only the author's app can build the view a new page version needs.
  // It still picks, for comments (shared-items design 2026-09-26 §6): the
  // view carries the frame bridge and the page's stamped element ids.
  const canEditDocument = isDocument && input.callerRole !== 'view';
  return {
    showDriftNotice: false,
    readOnly: !canEditDocument,
    pageModes: isPage ? ['view', 'pick'] : [],
    pushAgentContent: false,
    seedFromFile: false,
    versions: 'cloud',
    saveVersion: canEditDocument ? 'cloud' : null,
    pageFrame: isPage ? 'cloud' : null,
    fileView: null,
    showConfluencePublish: false,
  };
}
