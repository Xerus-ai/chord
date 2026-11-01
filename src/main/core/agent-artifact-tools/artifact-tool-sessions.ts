import { randomUUID } from 'node:crypto';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import type { PublishArtifactResult } from './publish-artifact';

/** What a tool call acts on. Never supplied by the agent — resolved from the session token. */
export interface ArtifactToolContext {
  sessionId: string;
  workItemId: string;
  cwd: string;
}

export interface ArtifactToolSession extends ArtifactToolContext {
  /** Settings › Agents › Artifacts at launch; it rides on the tool description. */
  preferredFormat: PreferredArtifactFormat;
  /** The session's live turn records the publish: the card, and no chip for that file. */
  onPublished: (result: PublishArtifactResult) => void;
}

const sessions = new Map<string, ArtifactToolSession>();

/**
 * One token per running agent session. The in-process Claude server closes
 * over it; the loopback endpoint for ACP agents (P3) receives it as a bearer
 * token. Either way the token is the only thing that says which work item a
 * publish lands in, so `work_item_id` never becomes a tool argument an agent
 * could get wrong.
 */
export function registerArtifactToolSession(session: ArtifactToolSession): {
  token: string;
  dispose: () => void;
} {
  const token = randomUUID();
  sessions.set(token, session);
  return { token, dispose: () => sessions.delete(token) };
}

export function resolveArtifactToolSession(token: string): ArtifactToolSession {
  const session = sessions.get(token);
  if (!session) {
    throw new Error('This Chord session has ended; its artifact tools are no longer available.');
  }
  return session;
}
