import { describe, expect, it } from 'vitest';
import { resolveArtifactSurface, type ArtifactSurface } from './artifact-surface';

/**
 * Which parts of an artifact tab exist, per where the artifact is read from
 * (design 2026-09-24 §9 "Desktop contract"): `local` is the author's own copy
 * on this device; `cloud` is everyone else, reading the server's copy.
 */
describe('resolveArtifactSurface — local (the author on this device)', () => {
  it('a document keeps every local feature: drift, agent push, file seed, local versions', () => {
    expect(
      resolveArtifactSurface({ source: 'local', renderClass: 'document', artifactType: 'markdown' })
    ).toEqual<ArtifactSurface>({
      showDriftNotice: true,
      readOnly: false,
      pageModes: [],
      pushAgentContent: true,
      seedFromFile: true,
      versions: 'local',
      saveVersion: 'local',
      pageFrame: null,
      fileView: null,
      showConfluencePublish: true,
    });
  });

  it('a web page offers in-place text edit and element picking, framed from the local file', () => {
    expect(
      resolveArtifactSurface({ source: 'local', renderClass: 'page', artifactType: 'web' })
    ).toEqual<ArtifactSurface>({
      showDriftNotice: true,
      readOnly: false,
      pageModes: ['view', 'edit-text', 'pick'],
      pushAgentContent: false,
      seedFromFile: false,
      versions: 'local',
      saveVersion: 'local',
      pageFrame: 'local',
      fileView: null,
      showConfluencePublish: true,
    });
  });

  it('a prototype picks elements but has no in-place text edit', () => {
    const surface = resolveArtifactSurface({
      source: 'local',
      renderClass: 'page',
      artifactType: 'prototype',
    });
    expect(surface.pageModes).toEqual(['view', 'pick']);
    expect(surface.pageFrame).toBe('local');
  });

  it('MDX is a page, not a document: framed, no editor seed, no agent push into an editor', () => {
    const surface = resolveArtifactSurface({
      source: 'local',
      renderClass: 'page',
      artifactType: 'mdx',
    });
    expect(surface.pageFrame).toBe('local');
    expect(surface.pageModes).toEqual(['view', 'pick']);
    expect(surface.pushAgentContent).toBe(false);
    expect(surface.seedFromFile).toBe(false);
  });
});

describe('resolveArtifactSurface — cloud (a teammate or artifact-only member)', () => {
  it('a document with Can edit co-edits the live doc: no drift, no agent push, no file seed', () => {
    expect(
      resolveArtifactSurface({
        source: 'cloud',
        renderClass: 'document',
        artifactType: 'markdown',
        callerRole: 'edit',
      })
    ).toEqual<ArtifactSurface>({
      showDriftNotice: false,
      readOnly: false,
      pageModes: [],
      pushAgentContent: false,
      seedFromFile: false,
      versions: 'cloud',
      saveVersion: 'cloud',
      pageFrame: null,
      fileView: null,
      showConfluencePublish: false,
    });
  });

  it('a document with Can view is read-only and cannot save a version', () => {
    const surface = resolveArtifactSurface({
      source: 'cloud',
      renderClass: 'document',
      artifactType: 'markdown',
      callerRole: 'view',
    });
    expect(surface.readOnly).toBe(true);
    expect(surface.saveVersion).toBeNull();
    expect(surface.versions).toBe('cloud');
  });

  it('the author on another device edits their document through the cloud', () => {
    const surface = resolveArtifactSurface({
      source: 'cloud',
      renderClass: 'document',
      artifactType: 'markdown',
      callerRole: 'author',
    });
    expect(surface.readOnly).toBe(false);
    expect(surface.saveVersion).toBe('cloud');
    expect(surface.showDriftNotice).toBe(false);
  });

  it('a web page renders the uploaded view: picking for comments, no in-place edit', () => {
    // Shared-items design 2026-09-26 §6: a teammate comments (D11 click-to-comment
    // and pins); the uploaded view carries the frame bridge and the stamped ids.
    expect(
      resolveArtifactSurface({
        source: 'cloud',
        renderClass: 'page',
        artifactType: 'web',
        callerRole: 'edit',
      })
    ).toEqual<ArtifactSurface>({
      showDriftNotice: false,
      readOnly: true,
      pageModes: ['view', 'pick'],
      pushAgentContent: false,
      seedFromFile: false,
      versions: 'cloud',
      // A page version needs a view built by the author's app; nobody else can make one.
      saveVersion: null,
      pageFrame: 'cloud',
      fileView: null,
      showConfluencePublish: false,
    });
  });

  it('prototypes and MDX render through the cloud frame the same way', () => {
    for (const artifactType of ['prototype', 'mdx'] as const) {
      const surface = resolveArtifactSurface({
        source: 'cloud',
        renderClass: 'page',
        artifactType,
        callerRole: 'view',
      });
      expect(surface.pageFrame).toBe('cloud');
      expect(surface.pageModes).toEqual(['view', 'pick']);
      expect(surface.saveVersion).toBeNull();
    }
  });
});

/**
 * Binary files (design 2026-09-24 §10): a pdf/docx/pptx or image is read-only
 * everywhere. It has no editor, no Yjs seed, no agent push and no manual save —
 * a file changes only when it is rewritten and republished.
 */
describe('resolveArtifactSurface — files', () => {
  it('the author sees the local file, with the drift notice and local versions', () => {
    expect(
      resolveArtifactSurface({ source: 'local', renderClass: 'file', artifactType: 'document' })
    ).toEqual<ArtifactSurface>({
      showDriftNotice: true,
      readOnly: true,
      pageModes: [],
      pushAgentContent: false,
      seedFromFile: false,
      versions: 'local',
      saveVersion: null,
      pageFrame: null,
      fileView: 'local',
      showConfluencePublish: false,
    });
  });

  it('a teammate with edit access still only views the uploaded file', () => {
    expect(
      resolveArtifactSurface({
        source: 'cloud',
        renderClass: 'file',
        artifactType: 'image',
        callerRole: 'edit',
      })
    ).toEqual<ArtifactSurface>({
      showDriftNotice: false,
      readOnly: true,
      pageModes: [],
      pushAgentContent: false,
      seedFromFile: false,
      versions: 'cloud',
      saveVersion: null,
      pageFrame: null,
      fileView: 'cloud',
      showConfluencePublish: false,
    });
  });
});
