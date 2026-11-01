import { describe, expect, it } from 'vitest';
import {
  getChatPermissionMode,
  getPreviousChatPermissionMode,
  setChatPermissionMode,
} from './permission-mode-store';

describe('permission-mode-store', () => {
  it("is unset (the agent's default mode) until something is picked", () => {
    expect(getChatPermissionMode('wi-none')).toBeNull();
    expect(getChatPermissionMode('wi-none', 's-none')).toBeNull();
  });

  it('falls back to the work item value for a session with no override', () => {
    setChatPermissionMode('wi-fallback', 'plan');
    expect(getChatPermissionMode('wi-fallback')).toBe('plan');
    expect(getChatPermissionMode('wi-fallback', 's-lazy')).toBe('plan');
    setChatPermissionMode('wi-fallback', null);
    expect(getChatPermissionMode('wi-fallback', 's-lazy')).toBeNull();
  });

  it('scopes a session value to that session only', () => {
    setChatPermissionMode('wi-scoped', 'acceptEdits', 's-a');
    expect(getChatPermissionMode('wi-scoped', 's-a')).toBe('acceptEdits');
    expect(getChatPermissionMode('wi-scoped', 's-b')).toBeNull();
    expect(getChatPermissionMode('wi-scoped')).toBeNull();
  });

  it("lets a session's own pick override a work item plan", () => {
    setChatPermissionMode('wi-override', 'plan');
    setChatPermissionMode('wi-override', 'default', 's-a');
    expect(getChatPermissionMode('wi-override', 's-a')).toBe('default');
    expect(getChatPermissionMode('wi-override', 's-b')).toBe('plan');
  });

  it('a work-item-wide set clears that work item session overrides only', () => {
    setChatPermissionMode('wi-wide', 'plan', 's-a');
    setChatPermissionMode('wi-other', 'plan', 's-x');
    setChatPermissionMode('wi-wide', null);
    expect(getChatPermissionMode('wi-wide', 's-a')).toBeNull();
    expect(getChatPermissionMode('wi-other', 's-x')).toBe('plan');
  });

  it('remembers the mode a session left, so leaving plan can return to it', () => {
    setChatPermissionMode('wi-back', 'acceptEdits', 's-a');
    setChatPermissionMode('wi-back', 'plan', 's-a');
    expect(getPreviousChatPermissionMode('wi-back', 's-a')).toBe('acceptEdits');
  });

  it('keeps the remembered mode when the same mode is set again', () => {
    setChatPermissionMode('wi-same', 'auto', 's-a');
    setChatPermissionMode('wi-same', 'plan', 's-a');
    setChatPermissionMode('wi-same', 'plan', 's-a');
    expect(getPreviousChatPermissionMode('wi-same', 's-a')).toBe('auto');
  });

  it("remembers the agent's default when plan was entered from it", () => {
    setChatPermissionMode('wi-fresh', 'plan', 's-a');
    expect(getPreviousChatPermissionMode('wi-fresh', 's-a')).toBeNull();
  });

  it('takes the previous mode from the work item value a session inherited', () => {
    setChatPermissionMode('wi-inherit', 'acceptEdits');
    setChatPermissionMode('wi-inherit', 'plan', 's-a');
    expect(getPreviousChatPermissionMode('wi-inherit', 's-a')).toBe('acceptEdits');
  });
});
