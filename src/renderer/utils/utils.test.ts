import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  // Bare twMerge returns only the colour for each of these, which is how a
  // sized row silently reverts to the inherited body size.
  it.each([
    ['text-list-row', 'text-text-muted'],
    ['text-body', 'text-text'],
    ['text-tiny', 'text-text-passive'],
    ['text-list-meta', 'text-status-warn'],
  ])('keeps %s alongside %s', (size, color) => {
    const result = cn(size, color).split(' ');
    expect(result).toContain(size);
    expect(result).toContain(color);
  });

  it('still collapses two font sizes to the last one', () => {
    expect(cn('text-body', 'text-list-row')).toBe('text-list-row');
  });

  it('still collapses two text colours to the last one', () => {
    expect(cn('text-text-muted', 'text-text')).toBe('text-text');
  });
});
