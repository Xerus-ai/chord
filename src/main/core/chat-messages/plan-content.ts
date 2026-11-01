/**
 * Derives the plan card's display fields from the raw ExitPlanMode markdown.
 * The markdown itself is the card body; these are the summary fields the
 * cloud wire (published_plan_requests) and collapsed card states need.
 */

/** The first ATX heading, any level — plans lead with `# Plan: ...`. */
export function extractPlanTitleFromMarkdown(markdown: string): string | null {
  for (const line of markdown.split('\n')) {
    const match = line.trim().match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/**
 * The first prose paragraph: not a heading, not a list item, not a code
 * fence. Truncated for the summary row — the full markdown is on the card.
 */
export function extractPlanOverviewFromMarkdown(markdown: string): string | null {
  let inFence = false;
  const paragraph: string[] = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!trimmed) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^(?:[-*+]\s|\d+[.)]\s|>\s?)/.test(trimmed)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(trimmed);
  }
  if (paragraph.length === 0) return null;
  const text = paragraph.join(' ');
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}
