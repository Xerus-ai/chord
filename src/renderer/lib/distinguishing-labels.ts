/**
 * Labels shown side by side (a pane's tabs, a lane's sessions in the sidebar),
 * each starting where it differs from the others (devstation-6w3p). Chats
 * titled from their first message often share a long start ("Remember the
 * codeword ALPHA-7…", "…BRAVO-3…"), and cut to fit they read alike. A label
 * that shares at least `SHARED_START_MIN` characters, up to a word boundary,
 * with a different label drops them for an ellipsis. Short shared starts,
 * identical labels and a label that is all of another one's start are kept
 * whole. Callers keep the full label for the tooltip and the accessible name.
 */

const SHARED_START_MIN = 12;

/** How many leading characters `label` shares with `other`, ending at a word boundary in `label`. */
function sharedWordStart(label: string, other: string): number {
  let length = 0;
  while (length < label.length && length < other.length && label[length] === other[length]) {
    length += 1;
  }
  if (length === label.length) return length;
  // `other` is all of this label's start, ending where a word of it ends.
  if (length === other.length && label[length] === ' ') return length + 1;
  return label.lastIndexOf(' ', length - 1) + 1;
}

export function distinguishLabels(labels: readonly string[]): string[] {
  return labels.map((label, index) => {
    let shared = 0;
    labels.forEach((other, otherIndex) => {
      if (otherIndex === index || other === label) return;
      shared = Math.max(shared, sharedWordStart(label, other));
    });
    if (shared < SHARED_START_MIN || shared >= label.length) return label;
    return `…${label.slice(shared)}`;
  });
}
