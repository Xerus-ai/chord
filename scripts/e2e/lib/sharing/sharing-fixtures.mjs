/**
 * Fixtures and bookkeeping for the P6 sharing done-check: results, cloud-only
 * work items and documents created over REST (the author's app is not needed
 * for them), and the list of things to remove when the run ends.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { parse } from 'dotenv';
import { ROOT } from '../seeded-app.mjs';

export function createResults() {
  let failures = 0;
  return {
    check(name, ok, detail = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
      if (!ok) failures += 1;
    },
    failures: () => failures,
  };
}

/** Expects `res.status` to be one of `statuses`; throws with the body otherwise. */
export function expectStatus(res, statuses, what) {
  const allowed = Array.isArray(statuses) ? statuses : [statuses];
  if (!allowed.includes(res.status)) {
    throw new Error(
      `${what}: expected ${allowed.join('/')}, got ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

export async function createCloudWorkItem(account, { orgId, name, generalAccess, generalRole }) {
  const id = randomUUID();
  const res = await account.api('POST', '/work-items', {
    id,
    name,
    org_id: orgId,
    general_access: generalAccess,
    general_role: generalRole,
  });
  expectStatus(res, [200, 201], `create work item "${name}"`);
  return id;
}

/** A document artifact registered in the cloud and seeded through its live Yjs doc. */
export async function createCloudDocument(account, workItemId, { name, text }) {
  const id = randomUUID();
  const res = await account.api('POST', `/work-items/${workItemId}/artifacts`, {
    id,
    name,
    content_type: 'markdown',
    render_class: 'document',
  });
  expectStatus(res, [200, 201], `create document "${name}"`);
  const doc = await account.openDocument(id);
  if (doc.state.denied) throw new Error(`Author could not open ${name}: ${doc.state.denied}`);
  doc.appendParagraph(text);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  doc.destroy();
  return id;
}

export async function findMemberId(account, scopePath, email) {
  const state = expectStatus(
    await account.api('GET', `${scopePath}/sharing`),
    200,
    'sharing state'
  );
  const member = state.members.find((m) => m.email === email);
  if (!member) throw new Error(`${email} is not a member of ${scopePath}`);
  return member.id;
}

/** The public-link token from the author's sharing state (`…/p/<token>`). */
export async function readLinkToken(account, scopePath) {
  const state = expectStatus(
    await account.api('GET', `${scopePath}/sharing`),
    200,
    'sharing state'
  );
  if (!state.link?.url) throw new Error(`${scopePath} has no live public link`);
  return new URL(state.link.url).pathname.split('/').filter(Boolean).pop();
}

/**
 * The sync server's database, for the one fixture no API can set: a team at its
 * seat limit. Reached through server/.env, the same database the server uses.
 */
export function openServerDatabase() {
  const env = parse(readFileSync(join(ROOT, 'server', '.env')));
  if (!env.DATABASE_URL) throw new Error('server/.env has no DATABASE_URL');
  return neon(env.DATABASE_URL);
}

/** Cleanup steps run in reverse order; every failure is reported, none hides another. */
export function createCleanup() {
  const steps = [];
  return {
    add(name, run) {
      steps.push({ name, run });
    },
    async run() {
      let failed = 0;
      for (const step of steps.reverse()) {
        try {
          await step.run();
        } catch (error) {
          failed += 1;
          console.error(`CLEANUP FAILED  ${step.name}: ${error.message}`);
        }
      }
      return failed;
    },
  };
}
