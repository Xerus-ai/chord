import { commentStoreFor } from './comment-store-for';

/** An artifact as the rail lists it: enough to tell which comment store it uses. */
export interface RailSummaryArtifact {
  id: string;
  cloudId: string | null;
}

/** `rpc.artifacts.listRailSummary`: the device's counts (main list-local-rail-summary.ts). */
export interface LocalRailSummaryRow {
  artifactId: string;
  openComments: number;
  latestVersion: number | null;
}

/** `GET /work-items/:id/artifact-summary` (server routes/artifact-summary.ts). */
export interface CloudArtifactSummaryRow {
  artifact_id: string;
  open_comments: number;
  unread: boolean;
  latest_version: number | null;
}

/**
 * What the rail shows for one artifact. `comments` is null while its store has
 * not answered for it: no count is shown rather than a wrong one.
 */
export interface ArtifactRailCounts {
  comments: { open: number; unread: boolean } | null;
  latestVersion: number | null;
}

/**
 * The rail's counts (shared-items step 1, S8). Comments come from the store
 * the comments card uses for that artifact: the cloud's, with the caller's
 * unread state, or this device's for an artifact that never synced, which is
 * never unread (every comment on it is the author's). The version is always
 * the device's, because the Versions card lists the device's versions.
 */
export function mergeArtifactRailSummaries({
  artifacts,
  local,
  cloud,
  signedIn,
}: {
  artifacts: RailSummaryArtifact[];
  local: LocalRailSummaryRow[];
  /** Undefined until the cloud answers (or when nothing needs it). */
  cloud: CloudArtifactSummaryRow[] | undefined;
  signedIn: boolean;
}): Map<string, ArtifactRailCounts> {
  const localById = new Map(local.map((row) => [row.artifactId, row]));
  const cloudById = new Map((cloud ?? []).map((row) => [row.artifact_id, row]));
  const merged = new Map<string, ArtifactRailCounts>();

  for (const artifact of artifacts) {
    const localRow = localById.get(artifact.id);
    // The device's read lists every artifact of the work item; a missing row
    // is a list newer than the summary, not an artifact without comments.
    if (!localRow) {
      merged.set(artifact.id, { comments: null, latestVersion: null });
      continue;
    }
    let comments: ArtifactRailCounts['comments'];
    if (commentStoreFor(artifact.cloudId, signedIn) === 'local') {
      comments = { open: localRow.openComments, unread: false };
    } else {
      const cloudRow = cloudById.get(artifact.id);
      comments = cloudRow ? { open: cloudRow.open_comments, unread: cloudRow.unread } : null;
    }
    merged.set(artifact.id, { comments, latestVersion: localRow.latestVersion });
  }
  return merged;
}
