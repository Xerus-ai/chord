import { describe, expect, it } from 'vitest';
import { collectDeclaredHrefRecord } from './_testing/repo-icon-href-cases';
import expected from './_testing/repo-icon-href.expected.json';

/**
 * Characterization (devstation-7orh): the declared-icon-href helpers were
 * rewritten from a behaviour spec, and the user's acceptance is zero change in
 * behaviour. The expected record was taken from the implementation before the
 * rewrite; every input must still give the same answer.
 */
describe('declared icon href, characterized', () => {
  it('reads the same href out of every declaring source', () => {
    expect(collectDeclaredHrefRecord().extract).toEqual(expected.extract);
  });

  it('tries the same repository paths for every href and declaring file', () => {
    expect(collectDeclaredHrefRecord().candidates).toEqual(expected.candidates);
  });
});
