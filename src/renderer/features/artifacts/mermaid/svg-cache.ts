/**
 * Bounded, least-recently-used cache of rendered mermaid SVG, keyed by
 * theme + diagram source.
 *
 * Every keystroke inside a ```mermaid fence produces a new source and therefore
 * a new key, so an unbounded cache accumulated one full SVG string per
 * intermediate state of a diagram for the lifetime of the window. Bounding it
 * keeps the win that matters — a diagram that has not changed is never
 * re-rendered on a collab keystroke elsewhere in the document or a tab switch —
 * without holding every draft that was ever typed.
 */
export class SvgCache {
  private readonly entries = new Map<string, string>();

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error(`SvgCache limit must be at least 1, got ${limit}`);
  }

  get size(): number {
    return this.entries.size;
  }

  read(key: string): string | undefined {
    const svg = this.entries.get(key);
    if (svg === undefined) return undefined;
    // Re-insert so the most recently used key sorts last in iteration order.
    this.entries.delete(key);
    this.entries.set(key, svg);
    return svg;
  }

  write(key: string, svg: string): void {
    this.entries.delete(key);
    this.entries.set(key, svg);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}
