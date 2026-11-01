import { describe, expect, it } from 'vitest';
import { participantLayoutKey } from './pane-host';
import { requestedArtifactLayoutKey } from './requested-artifact-layout';

/**
 * Where a requested artifact (a link, a notification) opens once its work item
 * resolves: the owner's own layout, or the teammate layout, scoped view
 * included (step 4, S9).
 */
describe('requestedArtifactLayoutKey', () => {
  it("opens in the owner's layout for a local item", () => {
    expect(requestedArtifactLayoutKey({ kind: 'local', id: 'wi-1' })).toBe('wi-1');
  });

  it('opens in the teammate layout for a cloud item and for a scoped one', () => {
    expect(requestedArtifactLayoutKey({ kind: 'cloud', id: 'wi-1' })).toBe(
      participantLayoutKey('wi-1')
    );
    expect(requestedArtifactLayoutKey({ kind: 'artifacts_only', id: 'wi-1' })).toBe(
      participantLayoutKey('wi-1')
    );
  });
});
