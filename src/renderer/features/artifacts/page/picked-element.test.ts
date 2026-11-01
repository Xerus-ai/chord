import { describe, expect, it } from 'vitest';
import type { PickedElement } from '@shared/artifact-frame-messages';
import { describePickedElementForAgent } from './picked-element';

function picked(overrides: Partial<PickedElement>): PickedElement {
  return {
    chordId: null,
    selector: 'body > main > p',
    sourceLocation: null,
    sourceLocationOf: null,
    tagName: 'p',
    text: 'Hello',
    html: '<p>Hello</p>',
    rect: { x: 0, y: 0, width: 10, height: 10 },
    ...overrides,
  };
}

describe('describePickedElementForAgent', () => {
  it('names a stamped element by its id', () => {
    const text = describePickedElementForAgent(picked({ chordId: 'abc12345' }));
    expect(text).toContain('data-chord-id="abc12345"');
    expect(text).not.toContain('CSS path');
  });

  it('gives an anchored CSS path as the element itself, and a truncated tail as a tail', () => {
    expect(describePickedElementForAgent(picked({ selector: 'body > main > p' }))).toContain(
      'at CSS path `body > main > p`'
    );
    expect(describePickedElementForAgent(picked({ selector: 'section#main > p' }))).toContain(
      'at CSS path `section#main > p`'
    );
    const tail = describePickedElementForAgent(
      picked({ selector: 'div > div:nth-of-type(2) > p' })
    );
    expect(tail).toContain('`div > div:nth-of-type(2) > p`');
    expect(tail).toMatch(/tail of .*path.*too long/i);
  });

  it('tells the agent where a compiled page element is written, itself or via its component', () => {
    const own = describePickedElementForAgent(
      picked({ sourceLocation: 'ui/button.tsx:3:5', sourceLocationOf: 'element' })
    );
    expect(own).toContain('`ui/button.tsx:3:5`');
    expect(own).toMatch(/written at/);
    const inner = describePickedElementForAgent(
      picked({ sourceLocation: 'ui/button.tsx:3:5', sourceLocationOf: 'ancestor' })
    );
    expect(inner).toContain('`ui/button.tsx:3:5`');
    expect(inner).toMatch(/inside the element written at/);
  });
});
