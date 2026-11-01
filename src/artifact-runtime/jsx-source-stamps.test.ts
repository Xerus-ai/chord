import { describe, expect, it } from 'vitest';
import { CHORD_SOURCE_ATTRIBUTE } from '@shared/artifact-frame-constants';
import { jsxRuntimeWithSourceStamps } from './jsx-source-stamps';

const { jsxDEV } = jsxRuntimeWithSourceStamps;
const at = { fileName: 'ui/badge.tsx', lineNumber: 2, columnNumber: 10 };

describe('jsxDEV with source stamps', () => {
  it('adds the source location to a host element and keeps its other props and key', () => {
    const element = jsxDEV(
      'span',
      { className: 'badge', children: 'x' },
      'k',
      false,
      at,
      undefined
    );
    expect(element.type).toBe('span');
    expect(element.key).toBe('k');
    expect(element.props).toEqual({
      className: 'badge',
      children: 'x',
      [CHORD_SOURCE_ATTRIBUTE]: 'ui/badge.tsx:2:10',
    });
  });

  it('leaves components and fragments alone: their DOM is stamped where it is written', () => {
    function Badge() {
      return null;
    }
    expect(jsxDEV(Badge, { n: 1 }, undefined, false, at, undefined).props).toEqual({ n: 1 });
    const fragment = jsxDEV(
      jsxRuntimeWithSourceStamps.Fragment,
      { children: [] },
      undefined,
      true,
      { fileName: 'a.mdx' },
      undefined
    );
    expect(fragment.props).toEqual({ children: [] });
  });

  it('refuses a host element compiled without a location', () => {
    expect(() => jsxDEV('div', {}, undefined, false, { fileName: 'a.tsx' }, undefined)).toThrow(
      /source location/
    );
  });
});
