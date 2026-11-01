import { describe, expect, it } from 'vitest';
import { describeSkippedSetup } from './lane-setup-bar-model';

/**
 * The provisioning bar of a lane whose setup did not run (`setup_status =
 * 'skipped'`). Two different stories share that status: the user chose Don't
 * run for a lane Chord made, or the lane is a checkout the user adopted, whose
 * setup Chord never runs on its own (plan §Phase 3 slice 6). The bar tells
 * them apart by the lane's `checkoutOrigin`.
 */
describe('describeSkippedSetup', () => {
  it('says an adopted checkout has not had setup run, not that the user declined it', () => {
    expect(describeSkippedSetup({ checkoutOrigin: 'adopted' })).toBe('Adopted — setup not run');
  });

  it("says Don't run for a lane Chord made", () => {
    expect(describeSkippedSetup({ checkoutOrigin: 'chord' })).toBe(
      "Setup skipped — you chose Don't run"
    );
  });
});
