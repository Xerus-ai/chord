import { describe, expect, it } from 'vitest';
import { decideSendReadiness } from './send-readiness';

describe('decideSendReadiness', () => {
  it('refuses while the worktree could not be created — the message has nowhere to run', () => {
    expect(
      decideSendReadiness({
        provisionStatus: 'failed',
        setupStatus: 'pending',
        agentStart: 'waitForSetup',
      })
    ).toEqual({ kind: 'refuse' });
  });

  it('waits for the checkout while it is still being created, whatever agentStart says', () => {
    expect(
      decideSendReadiness({
        provisionStatus: 'provisioning',
        setupStatus: 'pending',
        agentStart: 'immediately',
      })
    ).toEqual({ kind: 'wait', until: 'checkout' });
    expect(
      decideSendReadiness({
        provisionStatus: 'provisioning',
        setupStatus: 'pending',
        agentStart: 'waitForSetup',
      })
    ).toEqual({ kind: 'wait', until: 'setup' });
  });

  it('holds the first turn until setup succeeds when agents wait for setup', () => {
    for (const setupStatus of ['pending', 'running', 'failed']) {
      expect(
        decideSendReadiness({ provisionStatus: 'ready', setupStatus, agentStart: 'waitForSetup' })
      ).toEqual({ kind: 'wait', until: 'setup' });
    }
  });

  it("delivers straight away once setup is done, skipped by the user's Don't run, or not tracked", () => {
    for (const setupStatus of ['ok', 'skipped', null]) {
      expect(
        decideSendReadiness({ provisionStatus: 'ready', setupStatus, agentStart: 'waitForSetup' })
      ).toEqual({ kind: 'deliver' });
    }
  });

  it('delivers during setup when the user chose to start agents immediately', () => {
    expect(
      decideSendReadiness({
        provisionStatus: 'ready',
        setupStatus: 'running',
        agentStart: 'immediately',
      })
    ).toEqual({ kind: 'deliver' });
  });
});
