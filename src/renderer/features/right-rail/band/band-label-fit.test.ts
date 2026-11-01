import { describe, expect, it } from 'vitest';
import { fitBandLabel } from './band-label-fit';

/**
 * devstation-u59: the band picked its short form from the whole row's width
 * (under 250px), so at the default rail — 216px once the window controls are
 * cleared — it was always short, and a short form that still did not fit was
 * cut to "N..". The form now follows the room the label itself has.
 */
describe('fitBandLabel', () => {
  const widths = { full: 120, short: 40 };

  it('spells the state out whenever the sentence fits', () => {
    expect(fitBandLabel(120, widths)).toBe('full');
    expect(fitBandLabel(300, widths)).toBe('full');
  });

  it('drops to the short form only when the sentence does not fit', () => {
    expect(fitBandLabel(119, widths)).toBe('short');
    expect(fitBandLabel(40, widths)).toBe('short');
  });

  it('leaves the glyph alone rather than cutting the short form', () => {
    expect(fitBandLabel(39, widths)).toBe('icon');
    expect(fitBandLabel(0, widths)).toBe('icon');
  });
});
