import type { DeepLinkTarget } from '@shared/events/deepLinkEvents';
import type { RequestedArtifact } from '@renderer/features/work-list/requested-artifact-layout';
import type { RequestedMessage } from '@renderer/features/work-list/requested-message';

/**
 * A view to open for something addressed by id — a `chord://open/…` link, a
 * notification, a sidebar row. Mirrors the registered views' params
 * (`app/view-registry.ts`) without importing the registry into pure code.
 */
export type OpenTargetNavigation =
  | {
      view: 'work-list';
      params: {
        workItemId: string;
        openArtifact?: RequestedArtifact;
        revealMessage?: RequestedMessage;
      };
    }
  | { view: 'artifact-link'; params: { artifactId: string } }
  | { view: 'public-link'; params: { token: string } }
  /** Outside the app: a public link the caller cannot open in Chord, in the browser. */
  | { view: 'external'; url: string };

export function navigationForDeepLink(target: DeepLinkTarget): OpenTargetNavigation {
  switch (target.kind) {
    case 'work-item':
      return { view: 'work-list', params: { workItemId: target.workItemId } };
    case 'artifact':
      return { view: 'artifact-link', params: { artifactId: target.artifactId } };
    case 'public-link':
      return { view: 'public-link', params: { token: target.token } };
  }
}
