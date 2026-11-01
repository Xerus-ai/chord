export type BandLabelForm = 'full' | 'short' | 'icon';

/**
 * Which form of the state label the band shows, from the room the label has
 * and what each form needs: the sentence when it fits, the short form when
 * only that fits, the glyph alone (the sentence stays its tooltip) rather than
 * either cut mid-word (devstation-u59).
 */
export function fitBandLabel(
  available: number,
  widths: { full: number; short: number }
): BandLabelForm {
  if (widths.full <= available) return 'full';
  if (widths.short <= available) return 'short';
  return 'icon';
}
