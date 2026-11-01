export type DocumentSeedDecision = 'apply-seed' | 'keep-document';

/**
 * The file is a seed only: applied once, and only to a genuinely empty
 * document. Every input yields a decision — an absent seed (a teammate's cloud
 * document, an empty file) keeps the document as it is, so the editor still
 * settles and reports ready instead of waiting for a seed that never comes.
 */
export function decideDocumentSeed(input: {
  seed: string;
  documentEmpty: boolean;
}): DocumentSeedDecision {
  return input.seed && input.documentEmpty ? 'apply-seed' : 'keep-document';
}

export type DocumentSeedTiming = 'decide-now' | 'wait';

/**
 * When the seed decision may run: once the document's authoritative copy is
 * in. With a room on the collab server that is the server's copy; a room the
 * server does not hold (no cloud copy yet) has only its local copy, so waiting
 * for a server sync would leave the document blank until a failsafe timer
 * (design 2026-09-26 §7 bug 1). No collaborative document decides at once.
 */
export function decideSeedTiming(input: {
  hasRoom: boolean;
  joinsServer: boolean;
  serverSynced: boolean;
  localLoaded: boolean;
}): DocumentSeedTiming {
  if (!input.hasRoom) return 'decide-now';
  if (input.joinsServer) return input.serverSynced ? 'decide-now' : 'wait';
  return input.localLoaded ? 'decide-now' : 'wait';
}

/**
 * Whether a document's room is on the collab server. The server admits a room
 * only for an artifact it has (server/src/hocuspocus.ts `onAuthenticate`), so
 * an artifact that never synced — or a signed-out viewer — keeps a local room.
 */
export function joinsCollabServer(input: { signedIn: boolean; hasCloudCopy: boolean }): boolean {
  return input.signedIn && input.hasCloudCopy;
}
