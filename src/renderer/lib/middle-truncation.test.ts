import { describe, expect, it } from 'vitest';
import { splitMiddleTruncation } from './middle-truncation';

/**
 * Branch names share their head (`raghav/` plus the work item's slug) and
 * differ at their end (a lane's own slug, a hash). A row too narrow for the
 * whole name must keep that end: the name is split so the head can take the
 * ellipsis while the tail always shows (devstation-9wm).
 */
describe('splitMiddleTruncation', () => {
  it('keeps the last twelve characters of a long name as the tail', () => {
    expect(
      splitMiddleTruncation('chorddeveloper/chord-e2e-lanes-1791060073962-c19--second-lane')
    ).toEqual({
      head: 'chorddeveloper/chord-e2e-lanes-1791060073962-c19-',
      tail: '-second-lane',
    });
  });

  it('gives two lanes of one work item different tails', () => {
    const primary = splitMiddleTruncation('chorddeveloper/chord-e2e-lanes-1791060073962-c19');
    const second = splitMiddleTruncation(
      'chorddeveloper/chord-e2e-lanes-1791060073962-c19--second-lane'
    );
    expect(primary.tail).toBe('60073962-c19');
    expect(primary.tail).not.toBe(second.tail);
  });

  it('never splits off more than half of a short name, so its head still reads', () => {
    expect(splitMiddleTruncation('main')).toEqual({ head: 'ma', tail: 'in' });
    expect(splitMiddleTruncation('feat/held')).toEqual({ head: 'feat/', tail: 'held' });
  });

  it('loses nothing: head and tail are the whole name, in order', () => {
    for (const name of ['', 'x', 'origin/main', 'raghav/eng-42-fix-login-redirect-a3f']) {
      const { head, tail } = splitMiddleTruncation(name);
      expect(head + tail).toBe(name);
    }
  });
});
