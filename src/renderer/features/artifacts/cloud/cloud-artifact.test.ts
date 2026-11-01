import { describe, expect, it } from 'vitest';
import type { ArtifactVersion as CloudArtifactVersion } from '@renderer/lib/cloud-api';
import { parseCloudArtifactDetail, toArtifactVersionFromCloud } from './cloud-artifact';

/** A `GET /artifacts/:id` body as server/src/routes/artifacts.ts sends it. */
const RAW_DETAIL = {
  id: 'art1',
  work_item_id: 'wi1',
  work_item_name: 'Checkout redesign',
  name: 'Spec',
  content_type: 'markdown',
  render_class: 'document',
  general_access: 'invited',
  general_role: 'view',
  updated_at: '2026-09-26T10:00:00.000Z',
  caller_role: 'edit',
  work_item_role: 'edit',
};

describe('parseCloudArtifactDetail', () => {
  it('keeps the fields the workspace decides on', () => {
    expect(parseCloudArtifactDetail(RAW_DETAIL)).toEqual({
      id: 'art1',
      work_item_id: 'wi1',
      work_item_name: 'Checkout redesign',
      name: 'Spec',
      content_type: 'markdown',
      render_class: 'document',
      caller_role: 'edit',
      work_item_role: 'edit',
      updated_at: '2026-09-26T10:00:00.000Z',
    });
  });

  it('an artifact-only member has a null work_item_role', () => {
    const detail = parseCloudArtifactDetail({ ...RAW_DETAIL, work_item_role: null });
    expect(detail.work_item_role).toBeNull();
  });

  it('MDX arrives as a page', () => {
    const detail = parseCloudArtifactDetail({
      ...RAW_DETAIL,
      content_type: 'mdx',
      render_class: 'page',
    });
    expect(detail.render_class).toBe('page');
    expect(detail.content_type).toBe('mdx');
  });

  it('throws on a render class the app cannot draw', () => {
    expect(() => parseCloudArtifactDetail({ ...RAW_DETAIL, render_class: 'canvas' })).toThrow(
      /render_class/
    );
  });

  it('throws on an unknown caller role instead of guessing an access level', () => {
    expect(() => parseCloudArtifactDetail({ ...RAW_DETAIL, caller_role: 'owner' })).toThrow(
      /caller_role/
    );
  });

  it('throws on an unknown content type', () => {
    expect(() => parseCloudArtifactDetail({ ...RAW_DETAIL, content_type: 'spreadsheet' })).toThrow(
      /content_type/
    );
  });

  it('throws when the body is not an object', () => {
    expect(() => parseCloudArtifactDetail(null)).toThrow();
  });
});

describe('toArtifactVersionFromCloud', () => {
  it('maps a server version row onto the history panel shape', () => {
    const row: CloudArtifactVersion = {
      id: 'v3',
      artifact_id: 'art1',
      document_name: 'artifact:art1',
      version_number: 3,
      author_id: 'u1',
      author_name: 'Ana',
      label: 'Before review',
      byte_size: 2048,
      trigger: 'manual',
      created_at: '2026-09-26T09:00:00.000Z',
    };
    expect(toArtifactVersionFromCloud(row)).toEqual({
      id: 'v3',
      label: 'Before review',
      trigger: 'manual',
      author_name: 'Ana',
      created_at: '2026-09-26T09:00:00.000Z',
      version_number: 3,
      byte_size: 2048,
    });
  });
});
