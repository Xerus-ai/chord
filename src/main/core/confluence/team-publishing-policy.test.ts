import { describe, expect, it } from 'vitest';
import { assertTeamAllowsConfluencePublishing } from './team-publishing-policy';

/**
 * A team can turn off publishing to Confluence (Team settings). The device,
 * not the server, talks to Confluence, so every publish checks the policy
 * before it starts (shared-items step 3, decision 6).
 */
describe('assertTeamAllowsConfluencePublishing', () => {
  it('lets a publish through when the team allows it', () => {
    expect(() =>
      assertTeamAllowsConfluencePublishing({ allow_confluence_publishing: true })
    ).not.toThrow();
  });

  it("refuses, saying why, when the team doesn't", () => {
    expect(() =>
      assertTeamAllowsConfluencePublishing({ allow_confluence_publishing: false })
    ).toThrow("Your team doesn't allow publishing to Confluence");
  });
});
