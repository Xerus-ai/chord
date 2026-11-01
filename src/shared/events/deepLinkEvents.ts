import { defineEvent } from '@shared/ipc/events';

/**
 * A `chord://open/…` link the OS handed to the app (P6 sharing), parsed in
 * main and forwarded to the renderer, which opens the matching view:
 *   chord://open/work-item/<id>  → the work item (member or author)
 *   chord://open/artifact/<id>   → the artifact, even for an artifact-only member
 *   chord://open/p/<token>       → a public link, viewed in the app
 */
export type DeepLinkTarget =
  | { kind: 'work-item'; workItemId: string }
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'public-link'; token: string };

export const deepLinkOpenChannel = defineEvent<DeepLinkTarget>('deep-link-open');
