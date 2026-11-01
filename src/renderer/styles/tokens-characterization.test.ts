import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readTokenSheet } from './_testing/read-token-sheet';
import expected from './_testing/tokens.expected.json';

/**
 * Characterization (devstation-7orh): `tokens.css` was rewritten from its token
 * table, and the user's acceptance is that every token keeps its value. The
 * expected record was read from the sheet before the rewrite.
 */
const SHEET = join(dirname(fileURLToPath(import.meta.url)), 'tokens.css');

describe('design token sheet, characterized', () => {
  it('declares every token with the same value in the same selector and at-rule', () => {
    expect(readTokenSheet(SHEET).contexts).toEqual(expected.contexts);
  });

  it('keeps the contexts in the same cascade order', () => {
    expect(readTokenSheet(SHEET).contextOrder).toEqual(expected.contextOrder);
  });

  it('keeps the same statement at-rules', () => {
    expect(readTokenSheet(SHEET).atRules).toEqual(expected.atRules);
  });
});
