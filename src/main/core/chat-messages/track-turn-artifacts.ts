import { randomUUID } from 'node:crypto';
import { renderClassForArtifactType } from '@shared/artifact-render-class';
import type { PublishArtifactResult } from '@main/core/agent-artifact-tools/publish-artifact';
import { extractFileName } from '@main/core/artifacts/artifact-utils';
import {
  findArtifactByPath,
  listWorkItemArtifactRows,
} from '@main/core/artifacts/find-artifact-by-path';
import { pushArtifactContentToRenderer } from '@main/core/artifacts/push-to-yjs';
import { reportArtifactSourceDrift } from '@main/core/artifacts/watch-artifact-sources';
import { DocumentWriteRecorder } from './record-document-writes';
import type { TurnItemStream } from './stream-turn-items';

/**
 * A turn's artifacts: the cards for what the agent published, and — at turn
 * end — the chips for documents it wrote and did not publish.
 */
export class TurnArtifactTracker {
  readonly writes = new DocumentWriteRecorder((filePath) => this.refreshOpenArtifact(filePath));
  private workItemId: string | null = null;
  /** "Let agents create artifacts": off means no chips, as well as no tool. */
  private unpublishedChipsEnabled = false;

  constructor(
    private stream: TurnItemStream,
    private beginTurn: (workItemId: string) => void
  ) {}

  setSession(workItemId: string, cwd: string): void {
    this.workItemId = workItemId;
    this.writes.setWorkspaceDir(cwd);
  }

  setUnpublishedChipsEnabled(enabled: boolean): void {
    this.unpublishedChipsEnabled = enabled;
  }

  /** `publish_artifact` succeeded: the card joins the live turn, and the file is no chip. */
  recordPublished(workItemId: string, result: PublishArtifactResult): void {
    this.beginTurn(workItemId);
    this.writes.markPublished(result.path);
    // Pages have no Yjs document to reconcile; their frame reloads from disk.
    if (renderClassForArtifactType(result.format) === 'document') {
      pushArtifactContentToRenderer(workItemId, result.artifact_id, result.path);
    }
    this.stream.add(workItemId, {
      kind: 'artifact',
      id: randomUUID(),
      artifactId: result.artifact_id,
      filePath: result.path,
      title: result.title,
      type: result.format,
      preview: result.created ? 'Published by agent' : 'Updated by agent',
    });
  }

  /**
   * Called once per turn, before the turn is persisted: the chips for
   * documents written and not published (always clearing the turn's record),
   * then the work item's drift, since the turn may have changed a source.
   */
  completeTurn(workItemId: string): void {
    this.emitUnpublishedDocuments(workItemId);
    reportArtifactSourceDrift(workItemId);
  }

  private emitUnpublishedDocuments(workItemId: string): void {
    const existing = new Set(listWorkItemArtifactRows(workItemId).map((row) => row.filePath));
    const files = this.writes.takeUnpublishedDocuments(existing);
    if (!this.unpublishedChipsEnabled || files.length === 0) return;
    this.stream.add(workItemId, {
      kind: 'unpublished_documents',
      id: randomUUID(),
      files: files.map((filePath) => ({ filePath, name: extractFileName(filePath) })),
    });
  }

  /** A write to a file that already is an artifact reaches its open editor. */
  private refreshOpenArtifact(filePath: string): void {
    if (!this.workItemId) return;
    const artifact = findArtifactByPath(this.workItemId, filePath);
    if (!artifact) return;
    pushArtifactContentToRenderer(this.workItemId, artifact.id, filePath);
  }
}
