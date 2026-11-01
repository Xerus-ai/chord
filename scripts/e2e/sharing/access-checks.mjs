/**
 * Plan §4 P6 done-checks 1, 2, 3, 5, 7, 8 and 9 — who reaches a work item and
 * its document, through REST and the live Yjs connection, as two real users.
 */
import { waitFor } from './sharing-accounts.mjs';
import {
  createCloudDocument,
  createCloudWorkItem,
  expectStatus,
  findMemberId,
  openServerDatabase,
} from './sharing-fixtures.mjs';
import { followLink } from './teammate-ui-helpers.mjs';

const NO_SESSION = 'p6-e2e-no-such-session';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );
/** A prompt to a session that does not exist: exercises the Can edit gate, starts no agent turn. */
function sendPrompt(account, workItemId) {
  return account.api('POST', `/work-items/${workItemId}/commands`, {
    kind: 'prompt',
    session_id: NO_SESSION,
    payload: { content: 'P6 e2e: can this member drive the agent?' },
  });
}

/**
 * Checks 1, 2, 3, 7, 9 on one new work item with one document.
 * Returns ids later checks reuse (the document is published by viewing-checks).
 */
export async function runWorkItemChecks({ author, mate, team, stamp, results, cleanup }) {
  const { check } = results;
  const workItemId = await createCloudWorkItem(author, {
    orgId: team.org_id,
    name: `P6 e2e ${stamp} — shared work item`,
    generalAccess: 'invited',
    generalRole: 'view',
  });
  cleanup.add('delete work item 1', () => author.api('DELETE', `/work-items/${workItemId}`));
  const seed = `Seeded by the P6 e2e ${stamp}`;
  const docId = await createCloudDocument(author, workItemId, { name: 'Plan', text: seed });
  const itemPath = `/work-items/${workItemId}`;

  // ── 1: a new work item is invisible to a teammate ──────────────────────
  check(
    '1a  teammate gets 404 for a new work item',
    (await mate.api('GET', itemPath)).status === 404
  );
  const sharedList = expectStatus(await mate.api('GET', '/work-items/shared-with-me'), 200, 'list');
  check('1b  it is not in their shared list', !sharedList.some((w) => w.id === workItemId));
  const refused = await mate.openDocument(docId);
  check(
    '1c  no Yjs room for them',
    refused.state.denied !== null,
    `denied=${refused.state.denied}`
  );
  refused.destroy();

  // ── 2: Can view reads live and comments, cannot edit or chat ───────────
  expectStatus(
    await author.api('POST', `${itemPath}/members`, { email: mate.email, role: 'view' }),
    201,
    'invite teammate as Can view'
  );
  const opened = await mate.api('GET', itemPath);
  check(
    '2a  Can view opens the work item',
    opened.status === 200 && opened.body?.id === workItemId,
    `status ${opened.status}`
  );
  const viewerDoc = await mate.openDocument(docId);
  check('2b  Can view syncs the document', viewerDoc.synced && viewerDoc.readText().includes(seed));
  check('2c  the connection is read-only', viewerDoc.state.readOnly === true);
  const authorDoc = await author.openDocument(docId);
  authorDoc.appendParagraph(`live line ${stamp}`);
  let sawLive = true;
  await waitFor(
    () => viewerDoc.readText().includes(`live line ${stamp}`),
    10_000,
    'live edit'
  ).catch(() => {
    sawLive = false;
  });
  check("2d  Can view sees the author's edit live", sawLive);
  const comment = await mate.api('POST', `${itemPath}/artifacts/${docId}/comments`, {
    body: 'Comment from a Can view member',
  });
  check(
    '2e  Can view comments',
    comment.status === 201 && typeof comment.body?.id === 'string',
    `status ${comment.status}`
  );
  viewerDoc.appendParagraph(`viewer edit ${stamp}`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  check(
    '2f  a Can view edit never reaches the document',
    !authorDoc.readText().includes(`viewer edit ${stamp}`)
  );
  const viewerPrompt = await sendPrompt(mate, workItemId);
  // The route needs Can edit (server/src/routes/commands.ts): refused, not hidden.
  check(
    '2g  Can view cannot chat with the agent',
    viewerPrompt.status === 403,
    `status ${viewerPrompt.status}`
  );
  viewerDoc.destroy();

  // ── 3: Can edit co-edits and chats ─────────────────────────────────────
  const memberId = await findMemberId(author, itemPath, mate.email);
  expectStatus(
    await author.api('PATCH', `${itemPath}/members/${memberId}`, { role: 'edit' }),
    200,
    'make Can edit'
  );
  const editorDoc = await mate.openDocument(docId);
  check(
    '3a  Can edit gets a writable connection',
    editorDoc.synced && editorDoc.state.readOnly === false
  );
  editorDoc.appendParagraph(`editor line ${stamp}`);
  let sawEdit = true;
  await waitFor(
    () => authorDoc.readText().includes(`editor line ${stamp}`),
    10_000,
    'co-edit'
  ).catch(() => {
    sawEdit = false;
  });
  check("3b  the author sees the Can edit member's edit live", sawEdit);
  // Who may drive the agent stays the work item's approval policy (plan P6
  // "Roles"): owner-only by default, members once the author opts in.
  const ownerOnly = await sendPrompt(mate, workItemId);
  check(
    '3c  with the default policy only the author drives the agent',
    ownerOnly.status === 403,
    `status ${ownerOnly.status}`
  );
  // The composer says the same (step 4 S5c): the item has no chat, so the
  // teammate is in its Work item chat, where an owner-only policy offers the
  // thread and not the agent; the flip below reaches it live.
  const { page } = mate.instance;
  await followLink(mate, `chord://open/work-item/${workItemId}`);
  const threadOnly = await settles(
    page.getByPlaceholder('Message the thread, or mention @people…').first().waitFor({
      timeout: 45_000,
    })
  );
  check("3e  …and the teammate's composer offers the thread, not the agent", threadOnly);
  expectStatus(
    await author.api('PATCH', `${itemPath}/approval-policy`, { approval_policy: 'participants' }),
    200,
    'let members drive the agent'
  );
  const offersAgent = await settles(
    page.getByPlaceholder('Message the thread, or @agent to prompt it…').first().waitFor({
      timeout: 30_000,
    })
  );
  check("3f  the policy flip reaches the teammate's composer live", offersAgent);
  const editorPrompt = await sendPrompt(mate, workItemId);
  check(
    '3d  Can edit chats with the agent once the author allows members',
    editorPrompt.status === 201,
    `status ${editorPrompt.status}`
  );

  // ── 7: revoking removes access, including the open connection ─────────
  expectStatus(
    await author.api('DELETE', `${itemPath}/members/${memberId}`),
    [200, 204],
    'remove teammate'
  );
  let dropped = true;
  await waitFor(
    () => editorDoc.state.closed || editorDoc.state.denied !== null,
    15_000,
    'connection closed'
  ).catch(() => {
    dropped = false;
  });
  check('7a  the open co-editing connection is closed', dropped);
  check('7b  REST is 404 again', (await mate.api('GET', itemPath)).status === 404);
  editorDoc.destroy();
  authorDoc.destroy();

  // ── 9: the API refuses to make a work item public ──────────────────────
  const publicItem = await author.api('PATCH', `${itemPath}/general-access`, {
    general_access: 'link',
    general_role: 'view',
  });
  check(
    '9   a work item cannot be made public',
    publicItem.status === 400,
    `status ${publicItem.status}`
  );

  return { workItemId, docId, seed };
}

/** Check 5: "Anyone in the team" — members get the chosen role, non-members nothing. */
export async function runTeamAccessCheck({ author, mate, team, outside, stamp, results, cleanup }) {
  const { check } = results;
  const teamItem = await createCloudWorkItem(author, {
    orgId: team.org_id,
    name: `P6 e2e ${stamp} — team view`,
    generalAccess: 'team',
    generalRole: 'view',
  });
  cleanup.add('delete team work item', () => author.api('DELETE', `/work-items/${teamItem}`));
  const reached = await mate.api('GET', `/work-items/${teamItem}`);
  check(
    '5a  a team member reaches a team-shared work item',
    reached.status === 200 && reached.body?.id === teamItem,
    `status ${reached.status}`
  );
  const prompt = await sendPrompt(mate, teamItem);
  check(
    '5b  …with the chosen role (view: chat refused)',
    prompt.status === 403,
    `status ${prompt.status}`
  );

  if (!outside) {
    check('5c  a non-member gets nothing', false, 'teammate owns no team the author is outside of');
    return;
  }
  const outsideItem = await createCloudWorkItem(mate, {
    orgId: outside.org_id,
    name: `P6 e2e ${stamp} — other team`,
    generalAccess: 'team',
    generalRole: 'edit',
  });
  cleanup.add('delete other-team work item', () =>
    mate.api('DELETE', `/work-items/${outsideItem}`)
  );
  const stranger = await author.api('GET', `/work-items/${outsideItem}`);
  check(
    '5c  a non-member of that team gets nothing',
    stranger.status === 404,
    `status ${stranger.status}`
  );
}

/** Check 8: an outside email needs a seat; at the seat limit it is refused (no email is sent). */
export async function runSeatCheck({ author, team, workItemId, stamp, results, cleanup }) {
  const { check } = results;
  const itemPath = `/work-items/${workItemId}`;
  const email = `p6-e2e-${stamp}@example.com`;
  const asked = await author.api('POST', `${itemPath}/members`, { email, role: 'view' });
  check(
    '8a  inviting an outside email asks to add them to the team',
    asked.status === 409 && asked.body?.code === 'NOT_A_TEAM_MEMBER',
    `${asked.status} ${asked.body?.code}`
  );

  // The seat limit is checked before WorkOS is asked to send an email
  // (server/src/lib/team-invites.ts), so lowering it sends nothing.
  const sql = openServerDatabase();
  const [org] = await sql`select seat_limit from organizations where id = ${team.org_id}`;
  cleanup.add(
    'restore seat limit',
    () => sql`update organizations set seat_limit = ${org.seat_limit} where id = ${team.org_id}`
  );
  await sql`update organizations set seat_limit = 1 where id = ${team.org_id}`;
  const refused = await author.api('POST', `${itemPath}/members`, {
    email,
    role: 'view',
    add_to_team: true,
  });
  await sql`update organizations set seat_limit = ${org.seat_limit} where id = ${team.org_id}`;
  check(
    '8b  at the seat limit adding them is refused',
    refused.status === 403 && refused.body?.code === 'SEAT_LIMIT_REACHED',
    `${refused.status} ${refused.body?.code}`
  );
  const state = expectStatus(await author.api('GET', `${itemPath}/sharing`), 200, 'sharing state');
  check('8c  nobody was added', !state.members.some((m) => m.email === email));
}
