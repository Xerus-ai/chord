import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSharingFixture } from './sharing/__tests__/sharing-fixture.js';

/**
 * The rail's counts (shared-items step 1, S8): per artifact of a work item,
 * the open comment threads, whether the caller has unread comments, and the
 * latest version, all from one request. Unread is kept per account in the
 * cloud (step 1 plan §4 question 2): another person's comment newer than the
 * caller's last read of the artifact's comments.
 */
describe('artifact summary and comment reads (real DB)', () => {
  const f = createSharingFixture();

  beforeAll(() => f.start());
  afterAll(() => f.stop());

  async function setup() {
    const author = await f.makeUser();
    const teammate = await f.makeUser();
    const outsider = await f.makeUser();
    const orgId = await f.makeTeam(author.id, [teammate.id]);
    const created = await f.as(author.id).post('/work-items', {
      id: randomUUID(),
      name: 'item',
      org_id: orgId,
    });
    const workItemId = created.body.id as string;
    const shared = await f.as(author.id).post(`/work-items/${workItemId}/members`, {
      email: teammate.email,
      role: 'view',
    });
    expect(shared.status).toBe(201);

    const register = async (name: string) => {
      const id = randomUUID();
      const res = await f.as(author.id).post(`/work-items/${workItemId}/artifacts`, {
        id,
        name,
        content_type: 'markdown',
      });
      expect(res.status).toBe(201);
      return id;
    };
    const plan = await register('plan.md');
    const notes = await register('notes.md');
    const empty = await register('empty.md');

    return {
      author,
      teammate,
      outsider,
      workItemId,
      plan,
      notes,
      empty,
      summaryPath: `/work-items/${workItemId}/artifact-summary`,
      commentsPath: (artifactId: string) =>
        `/work-items/${workItemId}/artifacts/${artifactId}/comments`,
    };
  }

  async function comment(userId: string, path: string, body: string, parentId?: string) {
    const res = await f.as(userId).post(path, { body, parent_comment_id: parentId ?? null });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  async function addVersions(artifactId: string, count: number) {
    for (let n = 1; n <= count; n++) {
      await f.db.insert(f.s.artifactVersions).values({
        id: randomUUID(),
        artifact_id: artifactId,
        document_name: `artifact-${artifactId}`,
        version_number: n,
      });
    }
  }

  function byArtifact(body: Array<{ artifact_id: string }>) {
    return new Map(body.map((row) => [row.artifact_id, row]));
  }

  it('returns open threads, unread and the latest version for every artifact in one call', async () => {
    const s = await setup();
    const first = await comment(s.author.id, s.commentsPath(s.plan), 'first');
    await comment(s.teammate.id, s.commentsPath(s.plan), 'a reply', first);
    const second = await comment(s.author.id, s.commentsPath(s.plan), 'second');
    await comment(s.author.id, s.commentsPath(s.plan), 'third');
    const resolved = await f.as(s.author.id).post(`${s.commentsPath(s.plan)}/${second}/resolve`);
    expect(resolved.status).toBe(200);
    await comment(s.author.id, s.commentsPath(s.notes), 'only one');
    await addVersions(s.plan, 3);
    await addVersions(s.notes, 1);

    const res = await f.as(s.author.id).get(s.summaryPath);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    const rows = byArtifact(res.body);
    // Threads, not comments: the reply is part of `first`, and `second` is resolved.
    expect(rows.get(s.plan)).toEqual({
      artifact_id: s.plan,
      open_comments: 2,
      unread: true,
      latest_version: 3,
    });
    expect(rows.get(s.notes)).toEqual({
      artifact_id: s.notes,
      open_comments: 1,
      unread: false,
      latest_version: 1,
    });
    expect(rows.get(s.empty)).toEqual({
      artifact_id: s.empty,
      open_comments: 0,
      unread: false,
      latest_version: null,
    });
  });

  it('never counts the caller’s own comments as unread', async () => {
    const s = await setup();
    await comment(s.teammate.id, s.commentsPath(s.notes), 'from the teammate');

    const forTeammate = byArtifact((await f.as(s.teammate.id).get(s.summaryPath)).body);
    expect(forTeammate.get(s.notes)).toMatchObject({ unread: false, open_comments: 1 });

    const forAuthor = byArtifact((await f.as(s.author.id).get(s.summaryPath)).body);
    expect(forAuthor.get(s.notes)).toMatchObject({ unread: true, open_comments: 1 });
  });

  it('clears unread once the caller reads, and raises it again on a newer comment', async () => {
    const s = await setup();
    await comment(s.teammate.id, s.commentsPath(s.plan), 'look at this');

    const read = await f.as(s.author.id).put(`${s.commentsPath(s.plan)}/read`);
    expect(read.status).toBe(204);
    const afterRead = byArtifact((await f.as(s.author.id).get(s.summaryPath)).body);
    expect(afterRead.get(s.plan)).toMatchObject({ unread: false, open_comments: 1 });

    // Reading is per account: the teammate's own read state is untouched.
    await comment(s.author.id, s.commentsPath(s.plan), 'answered');
    const teammateView = byArtifact((await f.as(s.teammate.id).get(s.summaryPath)).body);
    expect(teammateView.get(s.plan)).toMatchObject({ unread: true });

    await comment(s.teammate.id, s.commentsPath(s.plan), 'one more thing');
    const again = byArtifact((await f.as(s.author.id).get(s.summaryPath)).body);
    expect(again.get(s.plan)).toMatchObject({ unread: true, open_comments: 3 });

    // A second read moves the same row forward rather than adding one.
    expect((await f.as(s.author.id).put(`${s.commentsPath(s.plan)}/read`)).status).toBe(204);
    const { and, eq } = await import('drizzle-orm');
    const reads = await f.db
      .select()
      .from(f.s.artifactCommentReads)
      .where(
        and(
          eq(f.s.artifactCommentReads.user_id, s.author.id),
          eq(f.s.artifactCommentReads.artifact_id, s.plan)
        )
      );
    expect(reads).toHaveLength(1);
    const cleared = byArtifact((await f.as(s.author.id).get(s.summaryPath)).body);
    expect(cleared.get(s.plan)).toMatchObject({ unread: false });
  });

  it('refuses the summary and the read without access to the work item', async () => {
    const s = await setup();

    const summary = await f.as(s.outsider.id).get(s.summaryPath);
    expect(summary.status).toBe(404);

    const read = await f.as(s.outsider.id).put(`${s.commentsPath(s.plan)}/read`);
    expect(read.status).toBe(404);
    const { eq } = await import('drizzle-orm');
    const reads = await f.db
      .select()
      .from(f.s.artifactCommentReads)
      .where(eq(f.s.artifactCommentReads.user_id, s.outsider.id));
    expect(reads).toEqual([]);
  });

  it('refuses a read of an artifact addressed through another work item', async () => {
    const s = await setup();
    const other = await setup();

    const res = await f
      .as(s.author.id)
      .put(`/work-items/${other.workItemId}/artifacts/${s.plan}/comments/read`);
    expect(res.status).toBe(404);
  });
});
