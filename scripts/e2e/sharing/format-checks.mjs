/**
 * P6 format coverage (design 2026-09-24 §9–§10): a web page, an MDX page and
 * one binary file of each kind — pdf, docx, pptx, png — published from the
 * author's app through "Add to artifacts", uploaded by its sync queue, shared
 * with the teammate alone, and read back as the teammate over REST. The
 * teammate's own app is driven in teammate-ui-checks.mjs.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REMOTE_SCRIPT, writeFormatFixtures } from './format-fixtures.mjs';
import { waitFor } from './sharing-accounts.mjs';
import { expectStatus } from './sharing-fixtures.mjs';

const MIME_BY_KIND = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  png: 'image/png',
};
const PAGE_KINDS = new Set(['web', 'mdx']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Publishes every format into the prototype's work item (the author's own, not
 * shared with the teammate) and shares each artifact with the teammate alone,
 * as Can view. Returns one entry per format with its cloud paths.
 */
export async function publishFormatsFromApp({ author, mate, stamp, cleanup, published }) {
  const { items } = await author.call('workItems.getAll');
  const workItem = items.find((item) => item.id === published.workItemId);
  if (!workItem?.repoPath) throw new Error('The prototype work item has no repository path');
  const dir = join(workItem.repoPath, '.chord-p6-fixtures', `formats-${stamp}`);
  cleanup.add('remove format fixtures', () => rmSync(dir, { recursive: true, force: true }));
  const { cssRule, formats } = await writeFormatFixtures(dir, stamp);

  const entries = [];
  for (const format of formats) {
    const name = `P6 ${format.kind} ${stamp}`;
    const created = await author.call('artifacts.create', {
      workItemId: workItem.id,
      filePath: format.path,
      name,
    });
    const artifactId = created.artifact.id;
    const artifactPath = `/work-items/${workItem.id}/artifacts/${artifactId}`;
    cleanup.add(`delete ${format.kind} artifact`, () => author.api('DELETE', artifactPath));
    entries.push({ ...format, name, artifactId, artifactPath, warnings: created.warnings });
  }

  for (const entry of entries) {
    const uploaded = PAGE_KINDS.has(entry.kind) ? 'view' : 'file';
    await waitFor(
      async () => (await author.api('GET', `${entry.artifactPath}/${uploaded}`)).status === 200,
      120_000,
      `${entry.kind} uploaded by the sync queue`
    );
    expectStatus(
      await author.api('POST', `${entry.artifactPath}/members`, {
        email: mate.email,
        role: 'view',
      }),
      201,
      `share the ${entry.kind} artifact alone`
    );
  }
  return { workItemId: workItem.id, cssRule, entries };
}

/** Checks 11–13: what the teammate reads over REST for each format. */
export async function runFormatApiChecks({ mate, formats, results }) {
  const { check } = results;
  const byKind = Object.fromEntries(formats.entries.map((entry) => [entry.kind, entry]));

  // 11 — web page: sibling assets inlined, the remote reference reported.
  const web = byKind.web;
  const webView = await mate.api('GET', `${web.artifactPath}/view`);
  const webHtml = webView.body?.html ?? '';
  check('11a  the web page view carries its marker', webHtml.includes(web.marker));
  check('11b  …its sibling stylesheet inlined', webHtml.includes(formats.cssRule));
  check('11c  …its sibling image inlined as data:', webHtml.includes('data:image/png;base64,'));
  check(
    '11d  the publish warned about the remote reference',
    web.warnings.some((w) => w.includes(REMOTE_SCRIPT)),
    JSON.stringify(web.warnings)
  );

  // 12 — MDX: a page, viewed through a view with the chart and diagram runtime.
  const mdx = byKind.mdx;
  const mdxMeta = await mate.api('GET', `/artifacts/${mdx.artifactId}`);
  check('12a  MDX is a page on the server', mdxMeta.body?.render_class === 'page');
  const mdxView = await mate.api('GET', `${mdx.artifactPath}/view`);
  const mdxHtml = mdxView.body?.html ?? '';
  check('12b  the MDX view carries its marker', mdxHtml.includes(mdx.marker));
  // `mermaidTooltip` is a name only mermaid's own bundle carries (the
  // standalone runtime has none), so its presence is the diagram library.
  check(
    '12c  …and inlines mermaid for its diagram',
    mdxHtml.includes('mermaidTooltip'),
    `${(mdxHtml.length / 1e6).toFixed(1)} MB`
  );

  // 13 — binary files: render class file, bytes intact, no Yjs room.
  for (const kind of ['pdf', 'docx', 'pptx', 'png']) {
    const entry = byKind[kind];
    const meta = await mate.api('GET', `/artifacts/${entry.artifactId}`);
    check(`13a  ${kind} is a file on the server`, meta.body?.render_class === 'file');
    const file = await mate.api('GET', `${entry.artifactPath}/file`);
    const local = readFileSync(entry.path);
    check(
      `13b  ${kind} arrives byte for byte with its MIME type`,
      file.status === 200 &&
        file.body.mime_type === MIME_BY_KIND[kind] &&
        sha256(Buffer.from(file.body.file_base64, 'base64')) === sha256(local),
      `status ${file.status} ${file.body?.mime_type ?? ''}`
    );
    const view = await mate.api('GET', `${entry.artifactPath}/view`);
    const hasView = kind === 'docx' || kind === 'png';
    check(
      `13c  ${kind} ${hasView ? 'has' : 'has no'} view`,
      hasView ? view.status === 200 : view.status === 404,
      `status ${view.status}`
    );
    const room = await mate.openDocument(entry.artifactId);
    check(`13d  ${kind} has no collaboration room`, room.state.denied !== null);
    room.destroy();
  }
}
