import { describe, expect, it } from 'vitest';
import { SvgCache } from './svg-cache';

describe('SvgCache', () => {
  it('returns what was written', () => {
    const cache = new SvgCache(3);
    cache.write('dark:graph TD', '<svg id="a" />');
    expect(cache.read('dark:graph TD')).toBe('<svg id="a" />');
  });

  it('reports a miss for a key it never held', () => {
    const cache = new SvgCache(3);
    expect(cache.read('light:graph TD')).toBeUndefined();
  });

  it('keys the same source separately per theme', () => {
    const cache = new SvgCache(3);
    cache.write('dark:graph TD', '<svg id="dark" />');
    cache.write('light:graph TD', '<svg id="light" />');
    expect(cache.read('dark:graph TD')).toBe('<svg id="dark" />');
    expect(cache.read('light:graph TD')).toBe('<svg id="light" />');
  });

  it('never grows past its limit', () => {
    const cache = new SvgCache(4);
    // One key per keystroke, which is what typing inside a mermaid fence does.
    for (let i = 0; i < 100; i++) cache.write(`dark:graph TD ${i}`, `<svg id="${i}" />`);
    expect(cache.size).toBe(4);
  });

  it('evicts the least recently written entry first', () => {
    const cache = new SvgCache(2);
    cache.write('a', '<svg id="a" />');
    cache.write('b', '<svg id="b" />');
    cache.write('c', '<svg id="c" />');

    expect(cache.read('a')).toBeUndefined();
    expect(cache.read('b')).toBe('<svg id="b" />');
    expect(cache.read('c')).toBe('<svg id="c" />');
  });

  it('a read protects an entry from the next eviction', () => {
    const cache = new SvgCache(2);
    cache.write('a', '<svg id="a" />');
    cache.write('b', '<svg id="b" />');
    // Touching 'a' makes 'b' the least recently used.
    cache.read('a');
    cache.write('c', '<svg id="c" />');

    expect(cache.read('a')).toBe('<svg id="a" />');
    expect(cache.read('b')).toBeUndefined();
  });

  it('rewriting an existing key does not grow the cache', () => {
    const cache = new SvgCache(2);
    cache.write('a', '<svg id="a" />');
    cache.write('a', '<svg id="a2" />');
    expect(cache.size).toBe(1);
    expect(cache.read('a')).toBe('<svg id="a2" />');
  });

  it('rejects a limit that could never hold an entry', () => {
    expect(() => new SvgCache(0)).toThrow(/at least 1/);
  });
});
