export interface TeamPublishingPolicy {
  allow_confluence_publishing: boolean;
}

/**
 * A team can turn off publishing to Confluence (Team settings, stored on the
 * server). The device, not the server, talks to Confluence, so every publish
 * checks it here before it starts: from the Publish tab, and the automatic
 * update alike (shared-items step 3, decision 6).
 */
export function assertTeamAllowsConfluencePublishing(policy: TeamPublishingPolicy): void {
  if (!policy.allow_confluence_publishing) {
    throw new Error("Your team doesn't allow publishing to Confluence");
  }
}
