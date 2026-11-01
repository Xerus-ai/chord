import { randomUUID } from 'node:crypto';
import type { StreamItem } from '@shared/stream-items';
import type { TurnItemStream } from './stream-turn-items';

/**
 * Appends the agent's streamed prose and reasoning to the live turn: deltas
 * extend the current text or thinking item, and a new content block opens a
 * paragraph.
 */
export class TurnTextAppender {
  /** A text block opened since the last text delta; see `appendText`. */
  private blockOpened = false;

  constructor(private readonly stream: TurnItemStream) {}

  openBlock(): void {
    this.blockOpened = true;
  }

  appendThought(workItemId: string, text: string): void {
    if (!text) return;
    const last = this.stream.lastItem();
    if (last && last.kind === 'thinking') {
      last.text += text;
      this.stream.update(workItemId, last);
      return;
    }

    this.stream.finalizeThoughts();
    this.stream.add(workItemId, {
      kind: 'thinking',
      id: randomUUID(),
      text,
      status: 'loading',
      startedAt: Date.now(),
    });
  }

  appendText(workItemId: string, text: string): void {
    if (!text) return;
    this.stream.finalizeThoughts();

    const target = this.textItemToContinue();
    // A new block continuing an existing item (only artifact cards between)
    // is a new paragraph. Without the break, consecutive agent messages were
    // glued mid-line: "…read them all in parallel.All files have been read…".
    const opensParagraph = this.blockOpened && target && !/\n\s*$/.test(target.text);
    this.blockOpened = false;
    if (target) {
      target.text += opensParagraph ? `\n\n${text}` : text;
      this.stream.update(workItemId, target);
    } else {
      this.stream.add(workItemId, { kind: 'text', id: randomUUID(), text });
    }
  }

  /**
   * The text item this delta belongs to, or undefined to start a new one.
   *
   * Artifact cards are emitted as a side effect of a write tool completing, so
   * they land wherever the agent happened to be mid-sentence — and appending
   * only when the card is *not* the tail started a second text item, cutting
   * the prose in two. Each half is then parsed as independent markdown, which
   * is why a table listing the files being written rendered as literal pipes:
   * its header row ended up in one item and its body in the next.
   *
   * So a run of trailing artifact cards is transparent — the prose continues
   * through it and the cards settle after the block they interrupted. Tool
   * calls deliberately are NOT transparent: the agent stops narrating to make
   * one, and "I'll check the config" / [Read] / "It's already set" is the
   * reading order that interleaving exists to produce.
   */
  private textItemToContinue(): (StreamItem & { kind: 'text' }) | undefined {
    const items = this.stream.listItems();
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.kind === 'text') return item;
      if (item.kind !== 'artifact') return undefined;
    }
    return undefined;
  }
}
