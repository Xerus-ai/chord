import { ARTIFACT_DOC_PREFIX, getActiveHocuspocus, type HocuspocusContext } from './hocuspocus.js';

/**
 * Live connections on the Yjs server. onAuthenticate only checks access at
 * connect time; access/recheck-live-access.ts uses these to close the
 * connections a sharing change invalidated, and an artifact re-registered as
 * a page has its room closed for whoever is in it.
 */

export interface LiveDocumentConnection {
  userId: string | undefined;
  readOnly: boolean;
  close(): void;
}

/** Every open connection on the artifact's collaboration document. */
export function listArtifactDocumentConnections(artifactId: string): LiveDocumentConnection[] {
  const server = getActiveHocuspocus();
  if (!server) return [];
  const document = server.hocuspocus.documents.get(`${ARTIFACT_DOC_PREFIX}${artifactId}`);
  if (!document) return [];
  return document.getConnections().map((connection) => ({
    userId: (connection.context as HocuspocusContext | undefined)?.user?.userId,
    readOnly: connection.readOnly,
    close: () => connection.close(),
  }));
}

/**
 * An artifact whose render class just became `page` has no collaboration
 * document any more (resolveDocumentAccess refuses new connections); this
 * drops the ones already open, whoever holds them.
 */
export function disconnectArtifactDocument(artifactId: string): void {
  for (const connection of listArtifactDocumentConnections(artifactId)) connection.close();
}
