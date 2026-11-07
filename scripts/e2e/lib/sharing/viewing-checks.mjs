/* global document -- frame.evaluate callbacks run inside the artifact frame */
/**
 * Plan §4 P6 done-checks 4 and 6, and the viewing model (design §9): a page
 * artifact published from the author's app is viewable by someone it was
 * shared with alone — in the browser signed out and in their own app — with the
 * author's app closed; a public document shows its saved version, not live edits.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../experience/run-record.mjs';
import { createRunWorkItem } from './run-work-item.mjs';
import { fetchSignedOut, waitFor } from './sharing-accounts.mjs';
import { expectStatus, readLinkToken } from './sharing-fixtures.mjs';

const SHOT_DIR = E2E_SHOTS_DIR;

function prototypeSource(marker) {
  return `import { useState } from 'react';

export default function Card() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ padding: 24 }}>
      <h1>${marker}</h1>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
    </main>
  );
}
`;
}

/**
 * The author's app publishes a prototype in the run's own work item (synced
 * to the cloud, not shared with the teammate): the app builds the view and
 * its sync queue uploads it.
 */
export async function publishPrototypeFromApp({ author, stamp, cleanup }) {
  const workItem = await createRunWorkItem({ author, stamp, cleanup });

  const marker = `P6 prototype ${stamp}`;
  const dir = join(workItem.repoPath, '.chord-p6-fixtures');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${stamp}-card.tsx`);
  const source = prototypeSource(marker);
  writeFileSync(filePath, source);
  cleanup.add('remove prototype fixture', () => rmSync(filePath, { force: true }));

  const { artifact } = await author.call('artifacts.create', {
    workItemId: workItem.id,
    filePath,
    name: `P6 card ${stamp}`,
  });
  if (!artifact) throw new Error('artifacts.create returned no row');
  const artifactId = artifact.id;
  const artifactPath = `/work-items/${workItem.id}/artifacts/${artifactId}`;
  cleanup.add('delete prototype artifact', () => author.api('DELETE', artifactPath));
  await waitFor(
    async () => (await author.api('GET', `/artifacts/${artifactId}`)).status === 200,
    60_000,
    'artifact registered in the cloud'
  );
  const { versions } = await author.call('artifacts.listVersions', { artifactId });
  await author.call('artifacts.saveVersion', {
    artifactId,
    content: source,
    trigger: 'manual',
    label: 'P6 e2e',
    baseVersion: versions[0]?.versionNumber ?? 0,
  });
  await waitFor(
    async () => (await author.api('GET', `${artifactPath}/view`)).status === 200,
    90_000,
    'view uploaded by the sync queue'
  );
  return { workItemId: workItem.id, artifactId, artifactPath, marker };
}

/** Check 4: an artifact shared alone opens for them; the work item stays closed. */
export async function runArtifactAloneCheck({ author, mate, published, results }) {
  const { check } = results;
  const { workItemId, artifactId, artifactPath, marker } = published;
  expectStatus(
    await author.api('POST', `${artifactPath}/members`, { email: mate.email, role: 'view' }),
    201,
    'share the artifact alone'
  );
  const meta = await mate.api('GET', `/artifacts/${artifactId}`);
  check(
    '4a  the artifact opens for them',
    meta.status === 200 && meta.body?.id === artifactId,
    `status ${meta.status}`
  );
  check('4b  …through its own access only', meta.body?.work_item_role === null);
  const listed = expectStatus(
    await mate.api('GET', '/artifacts/shared-with-me'),
    200,
    'shared artifacts'
  );
  check(
    '4c  it is listed under shared artifacts',
    listed.some((a) => a.id === artifactId)
  );
  for (const [what, path] of [
    ['work item', `/work-items/${workItemId}`],
    ['chat messages', `/work-items/${workItemId}/messages`],
    ['git state', `/work-items/${workItemId}/git-state`],
  ]) {
    const res = await mate.api('GET', path);
    check(
      `4d  ${what} stays closed to them`,
      [403, 404].includes(res.status),
      `status ${res.status}`
    );
  }
  const view = await mate.api('GET', `${artifactPath}/view`);
  check(
    '4e  they read the uploaded view',
    view.status === 200 && view.body?.html?.includes(marker)
  );
  // Self-contained: nothing in it is fetched from anywhere — no script or
  // stylesheet by URL, no http(s) reference in any src/href at all.
  const html = view.status === 200 ? view.body.html : '';
  const external = html.match(/<(?:script|link)\b[^>]*\b(?:src|href)=|(?:src|href)=["']https?:/gi);
  check(
    '4f  the view is self-contained',
    view.status === 200 && external === null,
    external ? `${external.length} external reference(s): ${external.slice(0, 3).join(' ')}` : ''
  );
}

/** Check 6 (page part): the prototype's public link renders signed out, sandboxed. */
export async function runPublicPageCheck({ author, published, results }) {
  const { check } = results;
  expectStatus(
    await author.api('PATCH', `${published.artifactPath}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    }),
    200,
    'make the prototype public'
  );
  const token = await readLinkToken(author, published.artifactPath);
  const host = await fetchSignedOut(`/p/${token}`);
  check(
    '6a  the public link renders signed out, framing the published view in a sandbox',
    host.status === 200 &&
      host.text.includes(`<iframe sandbox="allow-scripts" src="/p/${token}/frame"`)
  );
  const frame = await fetchSignedOut(`/p/${token}/frame`);
  const csp = frame.headers.get('content-security-policy') ?? '';
  check(
    '6b  the frame serves the published view',
    frame.status === 200 && frame.text.includes(published.marker)
  );
  check(
    '6c  …in the sandbox, embeddable only by Chord',
    csp.includes('sandbox') && csp.includes("frame-ancestors 'self'"),
    csp
  );
  return token;
}

/**
 * Check 6 (document part + team switch): a public document shows its latest
 * saved version, never unsaved live edits; a signed-in non-member comments;
 * with the team setting off the link stops working and cannot be re-created.
 */
export async function runPublicDocumentCheck({
  author,
  mate,
  team,
  doc,
  pageToken,
  stamp,
  results,
  cleanup,
}) {
  const { check } = results;
  const docPath = `/work-items/${doc.workItemId}/artifacts/${doc.docId}`;
  // Typed and saved at once, while connected: the stored copy is written on a
  // 2–10 s debounce, so the version must come from the live document.
  const editor = await author.openDocument(doc.docId);
  const justTyped = `JUST-TYPED-${stamp}`;
  editor.appendParagraph(justTyped);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expectStatus(
    await author.api('POST', `${docPath}/versions`, { label: 'Ready to share', trigger: 'manual' }),
    [200, 201],
    'save version'
  );
  editor.destroy();
  const live = await author.openDocument(doc.docId);
  const unsaved = `UNSAVED-LIVE-${stamp}`;
  live.appendParagraph(unsaved);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  live.destroy();

  expectStatus(
    await author.api('PATCH', `${docPath}/general-access`, {
      general_access: 'link',
      general_role: 'view',
    }),
    200,
    'make the document public'
  );
  const token = await readLinkToken(author, docPath);
  const page = await fetchSignedOut(`/p/${token}`);
  check(
    '6d  the public document shows its saved version',
    page.status === 200 && page.text.includes(doc.seed)
  );
  check(
    '6e  …including text typed just before saving',
    page.status === 200 && page.text.includes(justTyped)
  );
  check('6f  …and not unsaved live edits', page.status === 200 && !page.text.includes(unsaved));
  const comment = await mate.api('POST', `/public-links/${token}/comments`, {
    body: 'Signed-in non-member comment',
  });
  check(
    '6g  a signed-in non-member comments on the link',
    comment.status === 201 && typeof comment.body?.id === 'string',
    `status ${comment.status}`
  );

  const policyPath = `/organizations/${team.org_id}/sharing-policy`;
  cleanup.add('turn public links back on', () =>
    author.api('PATCH', policyPath, { allow_public_links: true })
  );
  expectStatus(
    await author.api('PATCH', policyPath, { allow_public_links: false }),
    200,
    'turn public links off'
  );
  const [docOff, pageOff] = await Promise.all([
    fetchSignedOut(`/p/${token}`),
    fetchSignedOut(`/p/${pageToken}`),
  ]);
  check(
    '6h  with the team setting off existing links stop working',
    docOff.status === 404 && pageOff.status === 404
  );
  const state = expectStatus(await author.api('GET', `${docPath}/sharing`), 200, 'sharing state');
  check('6i  …and the link option is gone', state.team_allows_public_links === false);
  expectStatus(
    await author.api('PATCH', policyPath, { allow_public_links: true }),
    200,
    'turn public links on'
  );
}

/**
 * The viewing model end to end: with the author's app CLOSED, the teammate
 * follows a chord://open/artifact link in their own app and the prototype
 * renders from the uploaded view.
 */
export async function runTeammateAppViewCheck({ author, mate, published, results }) {
  const { check } = results;
  await author.close();
  const link = `chord://open/artifact/${published.artifactId}`;
  await mate.instance.app.evaluate(({ app }, url) => {
    app.emit('second-instance', {}, [process.execPath, url], process.cwd());
  }, link);

  const { page } = mate.instance;
  let frame = null;
  await waitFor(
    async () => {
      frame = page.frames().find((f) => f.url().startsWith('chord-artifact://')) ?? null;
      if (!frame) return false;
      const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      return text.includes(published.marker);
    },
    60_000,
    'the prototype frame in the teammate app'
  ).catch(() => {
    frame = null;
  });
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, 'p6-teammate-view.png') });
  check('10a  the deep link opens the artifact in the teammate app', frame !== null);
  if (!frame) return;
  await frame.click('button');
  let clicked = false;
  await waitFor(
    async () => {
      clicked = await frame.evaluate(() => document.body.innerText.includes('Clicked 1 times'));
      return clicked;
    },
    10_000,
    'the click to count'
  ).catch(() => {});
  check("10b  the prototype runs with the author's app closed", clicked);
}
