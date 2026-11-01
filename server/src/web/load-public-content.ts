import type { PublicLinkTarget } from '../access/resolve-public-link.js';
import { fileTypeRule, isInlineFile } from '../artifact-file-types.js';
import {
  hasArtifactView,
  selectLatestFileMimeType,
  selectLatestPublishedVersion,
} from '../artifact-version-reads.js';
import { readVersionSnapshot } from '../hocuspocus.js';
import { renderDocumentHtml } from './render-document-html.js';

/**
 * What a public link shows, per render class (P6 §9 "Viewing model"):
 *   document → its latest `manual` or `agent_milestone` version, rendered to
 *              escaped HTML — never live state, never an `auto` version
 *   page     → (web, prototype, mdx) the latest uploaded view, served into
 *              the sandboxed frame by /p/:token/frame
 *   file     → (§10) an image or docx: its latest view, like a page; a pdf:
 *              its bytes, framed from /p/:token/file; a pptx: a download
 *   nothing published yet → the view says so
 */
export type PublicContent =
  | { kind: 'document'; html: string; text: string }
  | { kind: 'page'; mimeType: string | null }
  | { kind: 'file'; mimeType: string; inline: boolean }
  | { kind: 'unavailable'; reason: string };

export async function loadPublicContent(target: PublicLinkTarget): Promise<PublicContent> {
  if (target.renderClass === 'document') {
    const published = await selectLatestPublishedVersion(target.artifactId);
    if (!published) {
      return { kind: 'unavailable', reason: 'This document is not published yet.' };
    }
    const state = await readVersionSnapshot(published.document_name, published.id);
    if (!state) {
      throw new Error(
        `[web] published version ${published.id} of artifact ${target.artifactId} has no snapshot`
      );
    }
    return { kind: 'document', ...renderDocumentHtml(state) };
  }

  if (target.renderClass === 'page') {
    if (!(await hasArtifactView(target.artifactId))) {
      return { kind: 'unavailable', reason: 'This page is not published yet.' };
    }
    return { kind: 'page', mimeType: null };
  }

  if (target.renderClass === 'file') {
    const mimeType = await selectLatestFileMimeType(target.artifactId);
    if (mimeType === null) {
      return { kind: 'unavailable', reason: 'This file is not published yet.' };
    }
    if (fileTypeRule(mimeType).hasView) return { kind: 'page', mimeType };
    return { kind: 'file', mimeType, inline: isInlineFile(mimeType) };
  }

  throw new Error(`[web] unknown render class ${target.renderClass} for ${target.artifactId}`);
}
