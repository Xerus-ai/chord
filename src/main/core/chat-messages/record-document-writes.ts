import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import type { ToolFileLocation } from '@shared/stream-items';
import { isWorkspaceDeliverablePath } from '@main/core/agent-artifact-tools/workspace-deliverable-path';
import { isDocumentFile } from '@main/core/artifacts/artifact-utils';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';

const WRITE_TOOL_PATTERN = /write|edit|create|save/i;
const DOCUMENT_FILENAME_PATTERN = /(?:^|\s)([\w./-]+\.(?:md|mdx|pdf|docx|pptx))\b/i;
const TITLE_PATH_PATTERN = /([\w./:\\-]+\.(?:md|mdx|pdf|docx|pptx))\b/i;

/** SDK tool calls carry no locations — the written path lives in rawInput. */
export function toolLocationsFromRawInput(
  rawInput?: Record<string, unknown>
): ToolFileLocation[] | undefined {
  const fp = rawInput?.file_path ?? rawInput?.path;
  return typeof fp === 'string' && fp ? [{ filePath: fp }] : undefined;
}

/**
 * Records the documents an agent writes during a turn. It decides nothing:
 * an artifact exists only when the agent publishes it (`publish_artifact`) or
 * a person adds it. At turn end, the documents written but not published
 * become "Add to artifacts" chips — the one decider is the agent, the chip is
 * the person's way to disagree.
 */
export class DocumentWriteRecorder {
  private cwd: string | null = null;
  private suppressed = new Set<string>();
  /** Insertion-ordered: chips list files in the order the agent wrote them. */
  private written = new Set<string>();
  private published = new Set<string>();

  /** Called for every recorded document write, e.g. to refresh an open editor. */
  constructor(private onDocumentWrite: (filePath: string) => void = () => undefined) {}

  setWorkspaceDir(cwd: string | null): void {
    this.cwd = cwd;
  }

  /**
   * Agents report paths in whatever form their own tooling printed — on
   * Windows that is routinely an MSYS rendering (`/c/repo`, `/tmp/...`) that
   * no Chord consumer can open. Every path arriving from the agent is
   * translated against the session workspace before it is stored or rendered.
   */
  resolveReportedPath(filePath: string): string {
    return resolveAgentReportedPath(filePath, this.cwd);
  }

  /** The agent's own plan-mode draft is machinery, never a document to offer. */
  suppress(reportedPath: string): void {
    this.suppressed.add(this.resolveReportedPath(reportedPath));
  }

  recordWrite(reportedPath: string): void {
    if (!reportedPath) return;
    const filePath = this.resolveReportedPath(reportedPath);
    if (!this.cwd || this.suppressed.has(filePath)) return;
    if (!isWorkspaceDeliverablePath(filePath, this.cwd) || !isDocumentFile(filePath)) return;
    this.written.add(filePath);
    this.onDocumentWrite(filePath);
  }

  /** The written paths a completed write tool reports, from locations, title or output. */
  recordCompletedToolCall(
    event: AgentOutputEvent & { type: 'tool_call' },
    locations?: ToolFileLocation[]
  ): void {
    const isWriteTool = event.kind === 'edit' || WRITE_TOOL_PATTERN.test(event.name);
    if (!isWriteTool) return;

    const filePaths = (locations ?? []).map((loc) => loc.filePath).filter(Boolean);
    if (filePaths.length === 0) {
      const titlePath = TITLE_PATH_PATTERN.exec(event.title ?? event.name)?.[1];
      if (titlePath) filePaths.push(titlePath);
    }
    if (filePaths.length === 0 && event.content) {
      const match = event.content
        .map((block) => (block.text ? DOCUMENT_FILENAME_PATTERN.exec(block.text)?.[1] : undefined))
        .find(Boolean);
      if (match) filePaths.push(match);
    }
    for (const filePath of filePaths) this.recordWrite(filePath);
  }

  recordToolLocations(toolName: string, locations: ToolFileLocation[]): void {
    if (!WRITE_TOOL_PATTERN.test(toolName)) return;
    for (const loc of locations) this.recordWrite(loc.filePath);
  }

  markPublished(filePath: string): void {
    this.published.add(filePath);
  }

  /**
   * The turn's documents that are neither published this turn nor already an
   * artifact of the work item, in write order. Clears the turn.
   */
  takeUnpublishedDocuments(existingArtifactPaths: ReadonlySet<string>): string[] {
    const unpublished = [...this.written].filter(
      (filePath) => !this.published.has(filePath) && !existingArtifactPaths.has(filePath)
    );
    this.written.clear();
    this.published.clear();
    return unpublished;
  }
}
