import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor } from './sharing-accounts.mjs';
import { findMemberId } from './sharing-fixtures.mjs';
import { findFrameWith, followLink, showWorkItemPanel } from './teammate-ui-helpers.mjs';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

/**
 * A web page in the owner's work item, published and synced with its view:
 * only a web page's elements carry stamped ids (stamp-published-page.ts), so
 * only on one does a click-to-comment become a pin. The saved version is the
 * stamped file, which is what the uploaded view is built from.
 */
async function publishCommentPage({ author, workItemId, stamp, cleanup }) {
  const { items } = await author.call('workItems.getAll');
  const repoPath = items.find((w) => w.id === workItemId)?.repoPath;
  if (!repoPath) throw new Error('the owner’s work item has no repo for the page');
  const marker = `Comment page ${stamp}`;
  // The prototype's fixture directory, which publishPrototypeFromApp created.
  const filePath = join(repoPath, '.chord-p6-fixtures', `${stamp}-comments.html`);
  const page = [
    '<!doctype html>',
    `<html><head><title>${marker}</title></head><body>`,
    `<h1>${marker}</h1>`,
    '<p>A paragraph to comment on.</p>',
    '</body></html>',
  ];
  writeFileSync(filePath, `${page.join('\n')}\n`);
  cleanup.add('remove the comment page fixture', () => rmSync(filePath, { force: true }));
  const artifactName = `Comment page ${stamp}`;
  const { artifact } = await author.call('artifacts.create', {
    workItemId,
    filePath,
    name: artifactName,
  });
  if (!artifact) throw new Error('artifacts.create returned no row for the comment page');
  const artifactPath = `/work-items/${workItemId}/artifacts/${artifact.id}`;
  cleanup.add('delete the comment page artifact', () => author.api('DELETE', artifactPath));
  await waitFor(
    async () => (await author.api('GET', `/artifacts/${artifact.id}`)).status === 200,
    60_000,
    'the comment page registered in the cloud'
  );
  const { versions } = await author.call('artifacts.listVersions', { artifactId: artifact.id });
  await author.call('artifacts.saveVersion', {
    artifactId: artifact.id,
    content: readFileSync(filePath, 'utf-8'),
    trigger: 'manual',
    label: 'comment page e2e',
    baseVersion: versions[0]?.versionNumber ?? 0,
  });
  await waitFor(
    async () => (await author.api('GET', `${artifactPath}/view`)).status === 200,
    90_000,
    'the comment page view uploaded'
  );
  return { artifactId: artifact.id, artifactName, marker };
}

/** The owner's artifact tab in focus, its rail on the Work item panel (ARTIFACTS rows). */
async function openOwnerArtifact(author, workItemId, artifactName) {
  const { page } = author.instance;
  await followLink(author, `chord://open/work-item/${workItemId}`);
  await showWorkItemPanel(page);
  await page.getByText(artifactName, { exact: true }).first().click({ timeout: 60_000 });
  await page.locator('[data-testid="file-bar"]').first().waitFor({ timeout: 30_000 });
  await showWorkItemPanel(page);
}

/**
 * Checks 9a-9c (step 4 S11), the teammate as a collaborator rather than a
 * viewer: a Can view teammate's click-to-comment on a web page is a pin on
 * their page and the owner's, and a rise in the owner's rail count; made Can
 * edit, the owner's People list says so at once (9f) and their typing shows
 * above the owner's composer by name (9c). Runs after 8h, the teammate a
 * member.
 */
export async function runTeammateCollabChecks({
  author,
  mate,
  workItemId,
  stamp,
  cleanup,
  results,
  shot,
}) {
  const { check } = results;
  const ownerPage = author.instance.page;
  const matePage = mate.instance.page;
  const { artifactId, artifactName, marker } = await publishCommentPage({
    author,
    workItemId,
    stamp,
    cleanup,
  });

  await openOwnerArtifact(author, workItemId, artifactName);
  const ownerFrame = await findFrameWith(ownerPage, marker);
  if (!ownerFrame) throw new Error('the owner’s artifact frame did not show');
  const railCounts = ownerPage.locator(
    `[data-testid="artifact-rail-counts"][data-artifact-id="${artifactId}"]`
  );
  // 💬 N shows only once a thread is open (artifact-rail-row.tsx): absent is 0.
  const railComments = railCounts.locator('button[title="Open comments"]');
  const railCount = async () =>
    (await railComments.count()) === 0
      ? 0
      : Number((await railComments.innerText()).replace(/\D/g, '') || 0);
  await railCounts.waitFor({ timeout: 20_000 });
  const countBefore = await railCount();
  const pinsBefore = await ownerFrame.locator('[data-chord-pin]').count();

  // 9a/9b: the teammate comments from their own view of the artifact.
  await matePage.getByText(artifactName, { exact: true }).first().click({ timeout: 60_000 });
  const mateFrame = await findFrameWith(matePage, marker);
  if (!mateFrame) throw new Error('the teammate’s artifact frame did not show');
  await matePage
    .locator('[data-testid="file-bar"] button[title="Comments"]')
    .first()
    .click({ timeout: 30_000 });
  await matePage.locator('[data-testid="comments-card"]').waitFor({ timeout: 10_000 });
  await mateFrame.locator('h1').first().click();
  const popover = matePage.locator('[data-testid="ask-agent-card"]');
  await popover.waitFor({ timeout: 10_000 });
  await popover.locator('textarea').fill(`teammate comment ${stamp}`);
  await popover.getByRole('button', { name: 'Comment', exact: true }).click();
  await shot(mate, 'teammate-comment');

  const pinned = await settles(
    waitFor(
      async () => (await ownerFrame.locator('[data-chord-pin]').count()) > pinsBefore,
      30_000,
      'the teammate’s pin on the owner’s page'
    )
  );
  const ownPin = await settles(
    mateFrame.locator('[data-chord-pin]').first().waitFor({ timeout: 10_000 })
  );
  check(
    '9a  a teammate’s click-to-comment is a pin on their page and the owner’s',
    pinned && ownPin,
    `owner ${await ownerFrame.locator('[data-chord-pin]').count()} pins (${pinsBefore} before), teammate ${ownPin}`
  );
  const raised = await settles(
    waitFor(async () => (await railCount()) === countBefore + 1, 30_000, 'the rail count')
  );
  await shot(author, 'owner-teammate-pin');
  check(
    '9b  …and raises the owner’s rail count',
    raised,
    `before=${countBefore} after=${await railCount()}`
  );

  // 9c: Can edit, the teammate's draft shows as typing above the owner's composer.
  const itemPath = `/work-items/${workItemId}`;
  const memberId = await findMemberId(author, itemPath, mate.email);
  // The owner's People list, read before and after the role change: it must
  // follow the change live, not on its next refetch (devstation-n35).
  const peopleRow = ownerPage.locator(
    `[data-testid="participant-row"][data-user-id="${mate.userId}"]`
  );
  const roleBefore = await settles(
    waitFor(
      async () => (await peopleRow.getAttribute('data-role')) === 'view',
      20_000,
      'the teammate as Can view in the owner’s People list'
    )
  );
  const promoted = await author.api('PATCH', `${itemPath}/members/${memberId}`, { role: 'edit' });
  if (promoted.status !== 200) throw new Error(`make Can edit answered ${promoted.status}`);
  const roleAfter = await settles(
    waitFor(
      async () =>
        (await peopleRow.getAttribute('data-role')) === 'edit' &&
        (await peopleRow.innerText()).includes('Can edit'),
      10_000,
      'the teammate as Can edit in the owner’s People list'
    )
  );
  await shot(author, 'owner-people-role');
  check(
    '9f  the owner’s People list follows a role change made elsewhere, without a reload',
    roleBefore && roleAfter,
    `before=${roleBefore} after=${roleAfter}`
  );
  // The chat tabs: the owner's is the one a session ends from, the teammate's one they close.
  await ownerPage
    .locator('[aria-label^="End session "]')
    .first()
    .locator('xpath=ancestor::*[@title][1]')
    .click({ position: { x: 24, y: 12 }, timeout: 30_000 });
  await matePage
    .getByRole('tab')
    .filter({ has: matePage.locator('[aria-label^="Close tab "]') })
    .first()
    .click({ position: { x: 24, y: 12 }, timeout: 30_000 });
  const mateComposer = matePage.getByPlaceholder(/^Message/).first();
  const editable = await settles(
    waitFor(() => mateComposer.isEditable(), 30_000, 'the teammate’s composer to open')
  );
  // The line names the teammate as the People list does, by name and never
  // by email; it clears 3s after the last keystroke, so it is watched for
  // before typing.
  const sharing = await author.api('GET', `${itemPath}/sharing`);
  const mateName = sharing.body?.members?.find((m) => m.user_id === mate.userId)?.name;
  if (!mateName) throw new Error('the teammate has no name on the item’s sharing');
  const typing = ownerPage.getByText(`${mateName} is typing...`, { exact: true }).first();
  const seen = settles(typing.waitFor({ timeout: 20_000 }));
  if (editable) {
    await mateComposer.click();
    await mateComposer.pressSequentially(`typing ${stamp}`, { delay: 100 });
  }
  const shown = await seen;
  await shot(author, 'owner-sees-typing');
  check(
    '9c  Can edit: the teammate’s typing shows above the owner’s composer, by name',
    editable && shown,
    `editable=${editable} name=${mateName}`
  );
}
