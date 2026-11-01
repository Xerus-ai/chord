import { describe, expect, it } from 'vitest';
import { permissionResponseKind, selectThreadRequests } from './cloud-approvals';

const request = (request_id: string, session_id: string | null, status = 'pending') => ({
  request_id,
  session_id,
  status,
});

const ids = (rows: ReadonlyArray<{ request_id: string }>) => rows.map((r) => r.request_id);

/**
 * Which of the agent's pending requests a teammate's chat shows (step 4,
 * decision 5): each chat its own session's, and a request from no session
 * in the focused chat only, so it is answered in one place.
 */
describe('selectThreadRequests', () => {
  const rows = [
    request('mine', 's1'),
    request('theirs', 's2'),
    request('loose', null),
    request('done', 's1', 'resolved'),
  ];

  it("shows a chat its own session's pending requests", () => {
    expect(ids(selectThreadRequests(rows, { sessionId: 's1', focused: false }))).toEqual(['mine']);
  });

  it('shows a request from no session in the focused chat only', () => {
    expect(ids(selectThreadRequests(rows, { sessionId: 's2', focused: true }))).toEqual([
      'theirs',
      'loose',
    ]);
  });

  it('shows the item chat every pending request', () => {
    expect(ids(selectThreadRequests(rows, { sessionId: null, focused: false }))).toEqual([
      'mine',
      'theirs',
      'loose',
    ]);
  });
});

describe('permissionResponseKind', () => {
  it('sends the kind the owner device maps back to the agent option', () => {
    expect(permissionResponseKind({ optionId: 'o1', name: 'Allow', kind: 'allow_once' })).toBe(
      'allow_once'
    );
    expect(permissionResponseKind({ optionId: 'o2', name: 'Always', kind: 'allow_always' })).toBe(
      'allow_always'
    );
  });

  it('answers either reject with a one-time reject, the only one the wire carries', () => {
    expect(permissionResponseKind({ optionId: 'o3', name: 'Deny', kind: 'reject_always' })).toBe(
      'reject_once'
    );
  });

  it('has no answer for a kind the wire cannot carry', () => {
    expect(permissionResponseKind({ optionId: 'o4', name: 'Other', kind: 'custom' })).toBeNull();
  });
});
