import { describe, expect, it } from 'vitest';
import { previewWorktreeBranch } from './launcher-branch-preview';

describe('previewWorktreeBranch', () => {
  it('slugs a title onto the base branch', () => {
    expect(previewWorktreeBranch('feat/auth', 'Tests', [])).toBe('feat/auth--tests');
  });

  it('falls back to the next free number when the title is blank', () => {
    expect(previewWorktreeBranch('feat/auth', undefined, [])).toBe('feat/auth--2');
    expect(previewWorktreeBranch('feat/auth', '', ['feat/auth--2'])).toBe('feat/auth--3');
  });

  it('appends a numeric suffix when the slugged title collides', () => {
    expect(previewWorktreeBranch('feat/auth', 'Tests', ['feat/auth--tests'])).toBe(
      'feat/auth--tests-2'
    );
    expect(
      previewWorktreeBranch('feat/auth', 'Tests', ['feat/auth--tests', 'feat/auth--tests-2'])
    ).toBe('feat/auth--tests-3');
  });

  it('updates live as the title changes, matching main exactly', () => {
    expect(previewWorktreeBranch('main', 'Fix   bug!!', [])).toBe('main--fix-bug');
  });
});
