/**
 * The right rail band's state line, read as the user sees it: every text
 * `deriveBandState` (`src/renderer/features/right-rail/band/band-state.ts`)
 * can show, matched against the band's `title` (the full text, also when the
 * rail is too narrow and shows the short form).
 */
export const BAND_STATE =
  '^(\\d+ files? conflicted|Merged|\\d+ checks? (failing|running)|Changes requested|Ready to merge|\\d+ uncommitted files?|No remote|\\d+ commits? to push|Detached HEAD|Not published|Checking the branch…|Pushed · no pull request|Closed|Draft|In review)$';

export async function readBandState(page) {
  return page
    .locator('span[title]')
    .evaluateAll(
      (spans, source) => spans.map((s) => s.title).find((t) => new RegExp(source).test(t)) ?? null,
      BAND_STATE
    );
}
