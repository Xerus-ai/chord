import { artifactTypeForPath } from '@shared/artifact-render-class';
import type { ArtifactType } from '@shared/stream-items';

export type ArtifactStatus = 'draft' | 'in_review' | 'approved' | 'built';

/**
 * What produced a version row: a person pressing Save, an automatic snapshot,
 * or the agent publishing (`agent_milestone`).
 */
export type ArtifactVersionTrigger = 'manual' | 'auto' | 'agent_milestone';

/**
 * The document types an agent writes as deliverables-in-waiting: a write to
 * one that the agent does not publish becomes an "Add to artifacts" chip at
 * turn end. Images, `.html` and `.txt` stay out — they are code and assets,
 * and a chip for every one of them would bury the plans and briefs. They
 * remain publishable artifact types.
 */
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.pdf', '.docx', '.pptx']);

export function isDocumentFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  return DOCUMENT_EXTENSIONS.has(ext);
}

export function inferArtifactType(filePath: string): ArtifactType {
  const type = artifactTypeForPath(filePath.replace(/\\/g, '/'));
  if (!type) {
    throw new Error(`Unknown artifact extension: ${filePath.slice(filePath.lastIndexOf('.'))}`);
  }
  return type;
}

export function extractFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments[segments.length - 1] ?? filePath;
}
