import { statSync } from 'node:fs';
import type { AuthoredArtifactFormat } from '@shared/artifact-formats';
import type { ArtifactType } from '@shared/stream-items';
import {
  rebaselineArtifactSources,
  replaceArtifactSources,
} from '@main/core/artifacts/artifact-sources';
import { inferArtifactType } from '@main/core/artifacts/artifact-utils';
import { listWorkItemArtifactRows } from '@main/core/artifacts/find-artifact-by-path';
import { publishArtifactFile } from '@main/core/artifacts/publish-artifact-file';
import { resolveArtifactAuthorName } from '@main/core/artifacts/save-artifact-version';
import { reportArtifactSourceDrift } from '@main/core/artifacts/watch-artifact-sources';
import { updateConfluenceAfterChange } from '@main/core/confluence/auto-update-confluence';
import { appSettingsService } from '@main/core/settings/settings-service';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';
import type { ArtifactToolContext } from './artifact-tool-sessions';
import { isWorkspaceDeliverablePath } from './workspace-deliverable-path';

export interface PublishArtifactInput {
  path: string;
  title?: string;
  format?: AuthoredArtifactFormat;
  /** Files the artifact was written from; a change to one marks it out of date. */
  sources?: string[];
}

export interface PublishArtifactResult {
  artifact_id: string;
  path: string;
  title: string;
  format: ArtifactType;
  created: boolean;
  /** The version this publish saved — for a binary file, its bytes (§10). */
  version_number: number;
  /** Remote references the page's shared view blocks — teammates will not see them. */
  warnings: string[];
}

export interface ListedArtifact {
  artifact_id: string;
  path: string;
  title: string;
  format: string;
  status: string;
}

/**
 * Publishes a file the agent wrote as an artifact of the session's work item.
 *
 * Identity is the path: `(work_item_id, file_path)` is unique
 * (`schema-artifacts.ts` `idx_artifacts_work_item_file_path`), so publishing
 * a file that is already an artifact updates it and returns `created: false`
 * — there is no separate update tool for an agent to pick wrongly. Every
 * publish saves the file as a version, an agent milestone attributed to the
 * signed-in user (publish-artifact-file.ts); signed out, nothing is written.
 */
export async function publishArtifact(
  context: ArtifactToolContext,
  input: PublishArtifactInput
): Promise<PublishArtifactResult> {
  const settings = await appSettingsService.get('artifacts');
  if (!settings.enabled) {
    throw new Error(
      'Artifacts are turned off in Chord settings (Agents › Artifacts). Tell the user where the file is instead.'
    );
  }

  const filePath = resolveAgentReportedPath(input.path, context.cwd);
  if (!isWorkspaceDeliverablePath(filePath, context.cwd)) {
    throw new Error(
      `Cannot publish "${input.path}": it is outside the session workspace (${context.cwd}) or is agent machinery (.claude, .chord/plans). Write the file inside the workspace and publish that path.`
    );
  }
  if (!isExistingFile(filePath)) {
    throw new Error(`Cannot publish "${input.path}": ${filePath} does not exist. Write it first.`);
  }

  const type = inferPublishableType(filePath);
  if (input.format && input.format !== type) {
    throw new Error(
      `Format "${input.format}" contradicts the file extension of "${input.path}", which is ${type}. Rename the file or omit format.`
    );
  }

  const sources = resolveSourcePaths(input.sources, context.cwd, filePath);

  const authorName = await resolveArtifactAuthorName();
  if (!authorName) {
    throw new Error('Sign in to Chord to publish — versions are attributed to your account.');
  }

  const published = await publishArtifactFile({
    workItemId: context.workItemId,
    filePath,
    type,
    title: input.title,
    authorName,
  });
  const artifactId = published.artifact.id;
  // Publishing is the agent saying the artifact reflects its sources as they
  // are now: a new list replaces the old one, no list re-baselines the old one.
  if (sources) replaceArtifactSources(artifactId, sources);
  else rebaselineArtifactSources(artifactId);
  reportArtifactSourceDrift(context.workItemId);
  // A republish is a deliberate change: a published page follows it when set to.
  if (!published.created) updateConfluenceAfterChange({ artifactId });
  return {
    artifact_id: artifactId,
    path: filePath,
    title: published.artifact.name,
    format: type,
    created: published.created,
    version_number: published.versionNumber,
    warnings: published.warnings,
  };
}

/**
 * The agent's source list as real paths, checked before anything is written:
 * a source must be an existing file inside the session workspace, and not the
 * artifact itself. Undefined means the agent listed none.
 */
function resolveSourcePaths(
  sources: string[] | undefined,
  cwd: string,
  artifactPath: string
): string[] | undefined {
  if (sources === undefined) return undefined;
  const resolved = sources.map((source) => {
    const path = resolveAgentReportedPath(source, cwd);
    if (!isWorkspaceDeliverablePath(path, cwd)) {
      throw new Error(
        `Cannot use "${source}" as a source: it is outside the session workspace (${cwd}).`
      );
    }
    if (!isExistingFile(path)) {
      throw new Error(`Cannot use "${source}" as a source: ${path} does not exist.`);
    }
    if (path === artifactPath) {
      throw new Error(
        `"${source}" is the file being published; an artifact cannot be its own source.`
      );
    }
    return path;
  });
  return [...new Set(resolved)];
}

export async function listPublishedArtifacts(
  context: ArtifactToolContext
): Promise<ListedArtifact[]> {
  return listWorkItemArtifactRows(context.workItemId).map((row) => ({
    artifact_id: row.id,
    path: row.filePath,
    title: row.name,
    format: row.type,
    status: row.status,
  }));
}

function isExistingFile(filePath: string): boolean {
  const stat = statSync(filePath, { throwIfNoEntry: false });
  return stat?.isFile() ?? false;
}

function inferPublishableType(filePath: string): ArtifactType {
  try {
    return inferArtifactType(filePath);
  } catch (error) {
    throw new Error(
      `Cannot publish "${filePath}": ${(error as Error).message}. Publishable files are .md, .mdx, .html, .tsx, .jsx, .txt, .pdf, .docx, .pptx and images.`,
      { cause: error }
    );
  }
}
