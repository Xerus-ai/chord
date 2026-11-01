/** The branch's end that keeps its room before the title gets any. */
const MIN_TAIL_LENGTH = 8;
/** The most of the branch's end shown in full: a lane's own slug, or a hash. */
const MAX_TAIL_LENGTH = 12;
/** A title shows only with this many characters before its ellipsis; else not at all. */
const MIN_TITLE_LENGTH = 6;

export interface LaneLabelFit {
  /** Pixel widths; a part with 0 shows nothing (its text stays in the DOM). */
  suffixWidth: number;
  /** How many of the branch's last characters show in full. */
  tailLength: number;
  titleWidth: number;
  headWidth: number;
}

/**
 * How a lane row's "title branch → target" shares a row too narrow for it
 * (devstation-9wm), in this order:
 *   1. the branch's last eight characters — what tells two lanes of one item
 *      apart — with room for the "…" of a cut head. Lanes of a repository
 *      mostly share their target, so it goes second: first, a narrow row read
 *      "r… → origin/main" (devstation-kgua);
 *   2. the "→ target", ellipsized when the rest of the row cannot hold it whole;
 *   3. the title, when at least six of its characters fit;
 *   4. more of the branch's end, up to twelve characters;
 *   5. the branch's head.
 * The tooltip keeps every part. `measure` gives a string's rendered width in
 * the row's font.
 */
export function fitLaneLabel(args: {
  available: number;
  title: string | null;
  branch: string;
  suffix: string | null;
  measure: (text: string) => number;
}): LaneLabelFit {
  const { branch, measure } = args;
  const ellipsis = measure('…');
  let rest = Math.max(0, args.available);

  // A tail shorter than the branch leaves a head, which needs room for its "…".
  const tailCost = (length: number) =>
    (length > 0 ? measure(branch.slice(-length)) : 0) + (length < branch.length ? ellipsis : 0);
  const largestTail = (maxLength: number, budget: number) => {
    for (let length = Math.min(maxLength, branch.length); length > 0; length--) {
      if (tailCost(length) <= budget) return length;
    }
    return 0;
  };

  let tailLength = largestTail(MIN_TAIL_LENGTH, rest);
  rest = Math.max(0, rest - tailCost(tailLength));

  const suffixWidth = Math.min(args.suffix ? measure(args.suffix) : 0, rest);
  rest -= suffixWidth;

  let titleWidth = 0;
  const space = measure(' ');
  if (args.title) {
    const full = measure(args.title);
    const least = Math.min(full, measure(args.title.slice(0, MIN_TITLE_LENGTH) + '…'));
    if (rest - space >= least) {
      titleWidth = Math.min(full, rest - space);
      rest -= titleWidth + space;
    }
  }

  const longer = largestTail(MAX_TAIL_LENGTH, rest + tailCost(tailLength));
  if (longer > tailLength) tailLength = longer;

  // The head gets exactly what is left — the "…" room its tail reserved
  // included — and nothing when the parts before it took the whole row.
  const head = branch.slice(0, branch.length - tailLength);
  const used =
    suffixWidth +
    (tailLength > 0 ? measure(branch.slice(-tailLength)) : 0) +
    (titleWidth > 0 ? titleWidth + space : 0);
  const headWidth = head ? Math.max(0, Math.min(measure(head), args.available - used)) : 0;
  return { suffixWidth, tailLength, titleWidth, headWidth };
}
