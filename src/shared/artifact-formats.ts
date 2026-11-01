import type { ArtifactType } from './stream-items';

/**
 * The formats an agent authors as deliverables (plan 2026-09-23 §2.2). Each is
 * an `ArtifactType`, so the tool, the settings and the artifact rows share one
 * vocabulary. View-only types (`.pdf/.docx/.pptx`, images) stay publishable
 * through `publish_artifact` but are not offered here: agents do not author
 * them as deliverables. Canvas joins this list when it renders.
 */
export const AUTHORED_ARTIFACT_FORMATS = [
  'markdown',
  'mdx',
  'web',
  'prototype',
] as const satisfies readonly ArtifactType[];

export type AuthoredArtifactFormat = (typeof AUTHORED_ARTIFACT_FORMATS)[number];

/** "Best fit" means no preference: the agent picks per content. */
export const PREFERRED_ARTIFACT_FORMATS = ['best-fit', ...AUTHORED_ARTIFACT_FORMATS] as const;

export type PreferredArtifactFormat = (typeof PREFERRED_ARTIFACT_FORMATS)[number];

export interface AuthoredArtifactFormatMeta {
  /** User-facing name. */
  label: string;
  /** What the format is, in one line, for the settings row and the tool description. */
  description: string;
  /** Secondary muted line: the technical name users may know it by. */
  technicalName: string;
  /** The file extension an agent writes for this format. */
  extension: string;
  /** Editing level tag (§2.2). */
  editing: 'Edit together' | 'Edit in place' | 'Edit with agent';
}

export const AUTHORED_ARTIFACT_FORMAT_META: Record<
  AuthoredArtifactFormat,
  AuthoredArtifactFormatMeta
> = {
  markdown: {
    label: 'Document',
    description: 'Text with headings, lists and tables.',
    technicalName: 'Markdown',
    extension: '.md',
    editing: 'Edit together',
  },
  mdx: {
    label: 'Rich document',
    description: 'A document with live charts, tables and diagrams.',
    technicalName: 'MDX',
    extension: '.mdx',
    editing: 'Edit together',
  },
  web: {
    label: 'Web page',
    description: 'A styled page, laid out like a report or landing page.',
    technicalName: 'HTML',
    extension: '.html',
    editing: 'Edit in place',
  },
  prototype: {
    label: 'Interactive prototype',
    description: 'A clickable working demo with real buttons and state.',
    technicalName: 'React',
    extension: '.tsx',
    editing: 'Edit with agent',
  },
};
