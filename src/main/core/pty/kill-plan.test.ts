import { describe, expect, it } from 'vitest';
import { planAfterTreeKill, planKill } from './kill-plan';

// devstation-v1x2: what LocalPtySession.kill() does on Windows, as decisions. The shell's pid
// goes to taskkill only while the shell is alive; once it has exited, that pid may be another
// process's, so the console is closed instead.
describe('planKill', () => {
  it('ends nothing once node-pty reported the exit', () => {
    expect(planKill({ exitReported: true, shellExited: true })).toBe('none');
  });

  it('closes the console of a shell that exited but whose exit is not reported yet', () => {
    expect(planKill({ exitReported: false, shellExited: true })).toBe('console');
  });

  it('kills the tree of a live shell', () => {
    expect(planKill({ exitReported: false, shellExited: false })).toBe('tree');
  });
});

describe('planAfterTreeKill', () => {
  it('leaves an ended tree alone: node-pty reports the exit', () => {
    expect(planAfterTreeKill({ outcome: 'ended', exitReported: false, shellExited: true })).toBe(
      'none'
    );
  });

  it('closes the console when taskkill found no root (the shell exited meanwhile)', () => {
    expect(
      planAfterTreeKill({ outcome: 'not-found', exitReported: false, shellExited: true })
    ).toBe('console');
  });

  it('closes the console when processes outlived the kill but the shell is gone', () => {
    expect(planAfterTreeKill({ outcome: 'outlived', exitReported: false, shellExited: true })).toBe(
      'console'
    );
  });

  it("uses node-pty's kill when processes outlived the kill and the shell is still alive", () => {
    expect(
      planAfterTreeKill({ outcome: 'outlived', exitReported: false, shellExited: false })
    ).toBe('node-pty');
  });

  it('does nothing more once the exit was reported', () => {
    for (const outcome of ['ended', 'not-found', 'outlived'] as const)
      expect(planAfterTreeKill({ outcome, exitReported: true, shellExited: true })).toBe('none');
  });
});
