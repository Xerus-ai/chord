// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  describeCommentAnchorChange,
  describeCommentAnchorForAgent,
  parsePageForAnchors,
  verifyCommentAnchor,
} from './comment-anchor-status';

const PAGE =
  '<html><body><h1 data-chord-id="t1tle001">Quarterly   report</h1>' +
  '<p data-chord-id="body0001">Body <b>copy</b></p>' +
  '<p data-chord-id="dup00001">One</p><p data-chord-id="dup00001">Two</p></body></html>';

describe('verifyCommentAnchor', () => {
  const page = parsePageForAnchors(PAGE);

  it('matches when the element still has the tag and text the comment was made on', () => {
    expect(verifyCommentAnchor(page, 'chord-id:t1tle001', '<h1> Quarterly report')).toEqual({
      kind: 'matches',
    });
    expect(verifyCommentAnchor(page, 'chord-id:body0001', '<p> Body copy')).toEqual({
      kind: 'matches',
    });
  });

  it('reports a changed element with what it reads now', () => {
    expect(verifyCommentAnchor(page, 'chord-id:t1tle001', '<h1> Annual report')).toEqual({
      kind: 'changed',
      current: '<h1> Quarterly report',
    });
    expect(verifyCommentAnchor(page, 'chord-id:body0001', '<div> Body copy')).toEqual({
      kind: 'changed',
      current: '<p> Body copy',
    });
  });

  it('reports a missing element and an id two elements share', () => {
    expect(verifyCommentAnchor(page, 'chord-id:gone0001', '<p> Gone')).toEqual({ kind: 'missing' });
    expect(verifyCommentAnchor(page, 'chord-id:dup00001', '<p> One')).toEqual({
      kind: 'ambiguous',
    });
  });

  it('reports a verbatim copy of the element: the id still resolves, but N elements now read the same', () => {
    const copied = parsePageForAnchors(
      '<body><p class="x">Same</p><p class="x" data-chord-id="orig0001">Same</p><p>Same</p></body>'
    );
    expect(verifyCommentAnchor(copied, 'chord-id:orig0001', '<p> Same')).toEqual({
      kind: 'duplicated',
      count: 3,
    });
    expect(
      describeCommentAnchorForAgent('chord-id:orig0001', '<p> Same', {
        kind: 'duplicated',
        count: 3,
      })
    ).toMatch(
      /^Element changed since this comment: 3 elements now read <p> "Same" \(the comment's id is on one of them, data-chord-id="orig0001"\)\. Confirm with the user which one is meant: /
    );
    expect(describeCommentAnchorChange({ kind: 'duplicated', count: 3 })).toBe(
      'Element changed — 3 identical elements now; confirm which one is meant'
    );
  });

  it('cannot verify a comment that is not on a stamped element, or without the page source', () => {
    expect(verifyCommentAnchor(page, null, null)).toEqual({ kind: 'unverified' });
    expect(verifyCommentAnchor(page, 'selection:abc', 'some text')).toEqual({ kind: 'unverified' });
    expect(verifyCommentAnchor(null, 'chord-id:t1tle001', '<h1> Quarterly report')).toEqual({
      kind: 'unverified',
    });
  });
});

describe('describeCommentAnchorForAgent', () => {
  it('names the element by id when it matches, and says the element changed otherwise', () => {
    expect(
      describeCommentAnchorForAgent('chord-id:t1tle001', '<h1> Quarterly report', {
        kind: 'matches',
      })
    ).toBe('On the <h1> element with data-chord-id="t1tle001" ("Quarterly report"): ');
    expect(
      describeCommentAnchorForAgent('chord-id:t1tle001', '<h1> Quarterly report', {
        kind: 'changed',
        current: '<h1> Annual report',
      })
    ).toMatch(
      /^Element changed since this comment: it was <h1> "Quarterly report"; data-chord-id="t1tle001" now reads <h1> "Annual report"\. Confirm .*: /
    );
    expect(
      describeCommentAnchorForAgent('chord-id:gone0001', '<p> Gone', { kind: 'missing' })
    ).toMatch(
      /^Element changed since this comment: <p> "Gone" \(data-chord-id="gone0001"\) is no longer in the page source\..*: /
    );
    expect(describeCommentAnchorForAgent(null, 'plain quote', { kind: 'unverified' })).toBe(
      'On "plain quote": '
    );
    expect(describeCommentAnchorForAgent(null, null, { kind: 'unverified' })).toBe('');
  });
});
