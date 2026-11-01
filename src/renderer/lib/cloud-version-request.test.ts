import { describe, expect, it } from 'vitest';
import { buildSaveVersionBody } from './cloud-version-request';

/**
 * The body of `POST /work-items/:wid/artifacts/:aid/versions` for a document
 * (the server snapshots its live Yjs state; no content rides along).
 */
describe('buildSaveVersionBody', () => {
  it('a manual save names its base version, so a stale base is a 409 conflict', () => {
    expect(
      buildSaveVersionBody({ trigger: 'manual', baseVersion: 3, label: 'Before review' })
    ).toEqual({ trigger: 'manual', base_version: 3, label: 'Before review' });
  });

  it('a manual save without a label sends no label key', () => {
    const body = buildSaveVersionBody({ trigger: 'manual', baseVersion: 0 });
    expect(body).toEqual({ trigger: 'manual', base_version: 0 });
    expect('label' in body).toBe(false);
  });

  it('an agent milestone carries its trigger and label and no base version', () => {
    const body = buildSaveVersionBody({ trigger: 'agent_milestone', label: 'Agent update' });
    expect(body).toEqual({ trigger: 'agent_milestone', label: 'Agent update' });
    // A milestone records what the agent wrote, not an edit made on a seen
    // version: it must never be refused as a conflict.
    expect('base_version' in body).toBe(false);
  });
});
