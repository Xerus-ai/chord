import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { e2eSource } from './e2e-source.mjs';

describe('e2eSource', () => {
  let saved;

  beforeEach(() => {
    saved = process.env.CHORD_E2E_SOURCE;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.CHORD_E2E_SOURCE;
    else process.env.CHORD_E2E_SOURCE = saved;
  });

  it('unset gives built', () => {
    delete process.env.CHORD_E2E_SOURCE;
    expect(e2eSource()).toBe('built');
  });

  it('built gives built', () => {
    process.env.CHORD_E2E_SOURCE = 'built';
    expect(e2eSource()).toBe('built');
  });

  it('packaged gives packaged', () => {
    process.env.CHORD_E2E_SOURCE = 'packaged';
    expect(e2eSource()).toBe('packaged');
  });

  it('any other value throws', () => {
    for (const value of ['packge', 'Packaged', '']) {
      process.env.CHORD_E2E_SOURCE = value;
      expect(() => e2eSource()).toThrow(
        `CHORD_E2E_SOURCE must be 'built' or 'packaged', got '${value}'`
      );
    }
  });
});
