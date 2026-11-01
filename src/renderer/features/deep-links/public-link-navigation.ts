import type { OpenTargetNavigation } from './deep-link-navigation';

/** What asking the server about a public link told the app. */
export type PublicLinkLookup =
  | { kind: 'resolved'; artifactId: string }
  /** No such link, a dead one, or the caller does not reach it: one answer, nothing disclosed. */
  | { kind: 'not_found' }
  | { kind: 'signed_out' };

/**
 * Where a public link opened in the app goes (step 4, decision 10): the
 * artifact, as a tab of its work item, for a signed-in caller who reaches it;
 * otherwise the browser, which shows the link to anyone. `serverUrl` is the
 * sync server the renderer already talks to, which serves `/p/<token>`.
 */
export function navigationForPublicLink(
  lookup: PublicLinkLookup,
  serverUrl: string,
  token: string
): OpenTargetNavigation {
  if (lookup.kind === 'resolved') {
    return { view: 'artifact-link', params: { artifactId: lookup.artifactId } };
  }
  return { view: 'external', url: `${serverUrl.replace(/\/+$/, '')}/p/${token}` };
}
