import { describe, expect, it } from 'vitest';
import { describeScriptLayer } from './script-layer-note';

/**
 * Repo › Run & test: what a script field says about running it follows where
 * its value comes from — the user's own runs without asking, the team file's
 * asks first, and with no script anywhere there is nothing to say.
 */
describe('describeScriptLayer', () => {
  it("says the user's own script runs without asking", () => {
    expect(describeScriptLayer('justMe', 'single')).toBe('Yours: runs without asking.');
  });

  it("says the user's own run scripts run without asking, in place of the team's", () => {
    expect(describeScriptLayer('justMe', 'run')).toBe(
      "Yours: runs without asking, in place of the team file's run scripts."
    );
  });

  it("says the team file's script asks before it runs", () => {
    const asks = "From the team file: asks before it runs, until you've approved it.";
    expect(describeScriptLayer('team', 'single')).toBe(asks);
    expect(describeScriptLayer('team', 'run')).toBe(asks);
  });

  it('says nothing about running when there is no script anywhere', () => {
    expect(describeScriptLayer('default', 'single')).toBeNull();
    expect(describeScriptLayer('default', 'run')).toBeNull();
  });
});
