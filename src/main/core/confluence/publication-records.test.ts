import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a Confluence publication records and how its status reads (plan
 * 2026-09-23 §4 P5): the artifact version that was published, the page's
 * Confluence version at the time, and — from those — Published vN, Out of
 * date, or Edited in Confluence. Real SQLite from the shipped migrations.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { repos, workItems } = await import('@main/db/schema-work-items');
const { artifacts, artifactVersions } = await import('@main/db/schema-artifacts');
const { confluencePublications } = await import('@main/db/schema-confluence');
const { insertArtifactVersion } = await import('@main/core/artifacts/save-artifact-version');
const {
  describePublicationState,
  ensurePublishedVersion,
  findPublication,
  readPublishedContent,
  recordPublication,
} = await import('./publication-records');

const ARTIFACT_ID = 'a-confluence';
const SITE = 'https://example.atlassian.net';

beforeAll(async () => {
  await db.insert(repos).values({ id: 'r-cf', alias: 'repo', path: '/tmp/cf' });
  await db.insert(workItems).values({
    id: 'w-cf',
    repoId: 'r-cf',
    repoPath: '/tmp/cf',
    name: 'Confluence',
  });
  await db.insert(artifacts).values({
    id: ARTIFACT_ID,
    workItemId: 'w-cf',
    filePath: '/tmp/cf/plan.md',
    name: 'Plan',
  });
});

beforeEach(() => {
  db.delete(artifactVersions).run();
  db.delete(confluencePublications).run();
});

function save(content: string) {
  insertArtifactVersion({
    artifactId: ARTIFACT_ID,
    content,
    trigger: 'manual',
    authorName: 'tester',
    baseVersion: null,
  });
}

describe('ensurePublishedVersion', () => {
  it('saves the published content as a version when none exists', () => {
    expect(
      ensurePublishedVersion({ artifactId: ARTIFACT_ID, content: '<p>v1</p>', authorName: 'me' })
    ).toBe(1);
    const [row] = db.select().from(artifactVersions).all();
    expect(row).toMatchObject({
      versionNumber: 1,
      label: 'Published to Confluence',
      authorName: 'me',
    });
  });

  it('reuses the latest version when it already holds exactly that content', () => {
    save('<p>one</p>');
    save('<p>two</p>');
    expect(
      ensurePublishedVersion({ artifactId: ARTIFACT_ID, content: '<p>two</p>', authorName: 'me' })
    ).toBe(2);
    expect(db.select().from(artifactVersions).all()).toHaveLength(2);
  });

  it('saves a new version when the content moved on since the latest one', () => {
    save('<p>one</p>');
    expect(
      ensurePublishedVersion({
        artifactId: ARTIFACT_ID,
        content: '<p>edited</p>',
        authorName: 'me',
      })
    ).toBe(2);
    expect(readPublishedContent(ARTIFACT_ID, 2)).toBe('<p>edited</p>');
  });
});

describe('recordPublication', () => {
  it('upserts one row per artifact: a republish keeps the page id and moves the versions', () => {
    recordPublication({
      artifactId: ARTIFACT_ID,
      spaceKey: 'ENG',
      pageId: '123',
      confluenceVersion: 1,
      publishedArtifactVersion: 1,
    });
    recordPublication({
      artifactId: ARTIFACT_ID,
      spaceKey: 'ENG',
      pageId: '123',
      confluenceVersion: 2,
      publishedArtifactVersion: 3,
    });
    expect(db.select().from(confluencePublications).all()).toHaveLength(1);
    expect(findPublication(ARTIFACT_ID)).toMatchObject({
      pageId: '123',
      confluenceVersion: 2,
      publishedArtifactVersion: 3,
    });
  });
});

describe('describePublicationState', () => {
  const publication = {
    artifactId: ARTIFACT_ID,
    spaceKey: 'ENG',
    pageId: '123',
    confluenceVersion: 4,
    publishedArtifactVersion: 2,
    publishedAt: 1_790_000_000,
  };

  function describeWith(remoteVersion: number, currentContent: string) {
    return describePublicationState({
      publication,
      siteUrl: SITE,
      remoteVersion,
      currentContent,
      publishedContent: '<p>published</p>',
    });
  }

  it('is published while the page and the content both match what was recorded', () => {
    expect(describeWith(4, '<p>published</p>')).toEqual({
      state: 'published',
      pageId: '123',
      spaceKey: 'ENG',
      pageUrl: `${SITE}/wiki/pages/viewpage.action?pageId=123`,
      publishedArtifactVersion: 2,
      confluenceVersion: 4,
      remoteVersion: 4,
    });
  });

  it('is out of date when the artifact changed since it was published', () => {
    expect(describeWith(4, '<p>edited in Chord</p>').state).toBe('out_of_date');
  });

  it('is edited in Confluence when the page moved past the recorded version — even if Chord changed too', () => {
    expect(describeWith(5, '<p>published</p>').state).toBe('edited_in_confluence');
    expect(describeWith(5, '<p>edited in Chord</p>').state).toBe('edited_in_confluence');
  });
});
