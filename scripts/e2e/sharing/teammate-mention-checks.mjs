import { runTranscriptExperienceCheck } from '../experience/transcript-experience.mjs';
import { waitFor } from './sharing-accounts.mjs';
import { createCloudWorkItem, expectStatus } from './sharing-fixtures.mjs';
import { followLink } from './teammate-ui-helpers.mjs';

/**
 * Checks 9g-9h (step 4 S11, decision 8; devstation-bf9): who a teammate can
 * @mention. Their roster is the people with access, plus the team when the
 * item is open to the team. The proof needs a third person: in the team, but
 * not shared on the item. Without team access they are not offered (9g);
 * once the owner opens the item to the team, they are (9h).
 */
export async function runTeammateMentionChecks({
  author,
  mate,
  orgId,
  stamp,
  cleanup,
  results,
  shot,
}) {
  const { check } = results;
  const { page } = mate.instance;

  const members = expectStatus(
    await author.api('GET', `/organizations/${orgId}/members`),
    200,
    'the team roster'
  );
  const third = members.find((m) => m.email !== author.email && m.email !== mate.email);
  if (!third) {
    throw new Error(
      `9g-9h need a third member of team ${orgId} besides ${author.email} and ${mate.email}: ` +
        'sign one into a seed profile and invite them through the app'
    );
  }

  const workItemId = await createCloudWorkItem(author, {
    orgId,
    name: `Step 4 e2e ${stamp} — team mentions`,
    generalAccess: 'invited',
    generalRole: 'view',
  });
  cleanup.add('delete the team-mentions work item', () =>
    author.api('DELETE', `/work-items/${workItemId}`)
  );
  const itemPath = `/work-items/${workItemId}`;
  expectStatus(
    await author.api('POST', `${itemPath}/members`, { email: mate.email, role: 'edit' }),
    [200, 201],
    'share the team-mentions item, Can edit'
  );

  await followLink(mate, `chord://open/work-item/${workItemId}`);
  const composer = page.getByPlaceholder(/mention @people/).first();
  await composer.waitFor({ timeout: 45_000 });

  /** Opens the @ menu fresh, screenshots it open as `shotName`, and reads its People rows. */
  async function readPeopleOffered(shotName) {
    await composer.fill('');
    await composer.click();
    await page.keyboard.type('@');
    const menu = page
      .locator('.floating-surface-solid')
      .filter({ has: page.getByText('People', { exact: true }) })
      .first();
    await menu.waitFor({ timeout: 15_000 });
    const text = await menu.innerText();
    if (shotName) await shot(mate, shotName);
    await page.keyboard.press('Escape');
    await composer.fill('');
    return text;
  }

  const invitedOnly = await readPeopleOffered('teammate-mention-invited');
  check(
    '9g  without team access, the teammate’s @ menu leaves out a team member not on the item',
    invitedOnly.includes(author.email) && !invitedOnly.includes(third.email),
    JSON.stringify({ third: third.email, menu: invitedOnly.replace(/\s+/g, ' ') })
  );

  expectStatus(
    await author.api('PATCH', `${itemPath}/general-access`, {
      general_access: 'team',
      general_role: 'view',
    }),
    200,
    'open the item to the team'
  );
  let teamWide = '';
  const offered = await waitFor(
    async () => {
      teamWide = await readPeopleOffered(null);
      return teamWide.includes(third.email);
    },
    45_000,
    'the team member in the teammate’s @ menu'
  ).then(
    () => true,
    () => false
  );
  if (offered) await readPeopleOffered('teammate-mention-team');
  check(
    '9h  …with team access, the @ menu offers them',
    offered,
    JSON.stringify({ third: third.email, menu: teamWide.replace(/\s+/g, ' ') })
  );
  await runTranscriptExperienceCheck({ id: '9i', account: mate, who: 'the teammate', results });
}
