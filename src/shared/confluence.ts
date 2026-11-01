import type { ArtifactType } from '@shared/stream-items';

/**
 * Documents publish their live content — what the editor holds, including
 * teammates' edits, which never reach the file (P5 decision 2026-09-24).
 * Every other format publishes its file.
 */
export function isLiveDocumentType(type: ArtifactType): boolean {
  return type === 'markdown' || type === 'text';
}

/** A Confluence space the connected account can publish into. */
export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type: string;
}

/** The Confluence connection on this device (Settings › Connections › Integrations). */
export type ConfluenceConnectionStatus =
  | { connected: false; error?: string }
  | { connected: true; siteUrl: string; displayName: string };

interface PublishedPage {
  pageId: string;
  spaceKey: string;
  pageUrl: string;
  /** The artifact version whose content the page shows ("Published vN"). */
  publishedArtifactVersion: number;
  /** The page's Confluence version when Chord last wrote it. */
  confluenceVersion: number;
  /** The page's Confluence version now. */
  remoteVersion: number;
}

/**
 * An artifact's Confluence status (plan 2026-09-23 §4 P5). Chord is the
 * source of truth: `out_of_date` means the artifact changed since it was
 * published; `edited_in_confluence` means someone changed the page after
 * Chord last wrote it, and an update would overwrite that edit.
 */
export type ConfluencePublicationStatus =
  | { state: 'unpublished' }
  | ({ state: 'published' | 'out_of_date' | 'edited_in_confluence' } & PublishedPage);

export const CONFLUENCE_UPDATE_MODES = ['ask', 'auto'] as const;
export type ConfluenceUpdateMode = (typeof CONFLUENCE_UPDATE_MODES)[number];
