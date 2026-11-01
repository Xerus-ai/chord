import type { ReactElement } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { CHORD_SOURCE_ATTRIBUTE } from '@shared/artifact-frame-constants';

/** What esbuild's and MDX's `jsxDev` output passes as the fifth argument. */
interface JsxSource {
  fileName?: unknown;
  lineNumber?: unknown;
  columnNumber?: unknown;
}

type JsxProps = Record<string, unknown>;

function isLocated(source: JsxSource | undefined): source is {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
} {
  return (
    source !== undefined &&
    typeof source.fileName === 'string' &&
    typeof source.lineNumber === 'number' &&
    typeof source.columnNumber === 'number'
  );
}

/**
 * The `jsxDEV` prototypes and MDX pages are compiled against (bead
 * devstation-975 fix 5). Chord's compile step emits every JSX element as a
 * `jsxDEV` call carrying where it was written; here a host element (a string
 * type — `div`, `button`, `svg`) gets that as `data-chord-src`, so the picker
 * can report which line of which file renders it. A component's own elements
 * are stamped where the component writes them, not at its call site: this is
 * called for the component's JSX in turn. Compile-time and render-time only —
 * nothing touches the author's files, and the stamp rides along into the
 * published view, which is compiled the same way.
 */
function jsxDEV(
  type: unknown,
  props: JsxProps,
  key: unknown,
  isStatic: boolean,
  source: JsxSource | undefined,
  _self: unknown
): ReactElement {
  const create = (isStatic ? jsxs : jsx) as (t: unknown, p: JsxProps, k?: unknown) => ReactElement;
  if (typeof type !== 'string') return create(type, props, key);
  if (!isLocated(source)) {
    throw new Error(`<${type}> was compiled without a source location`);
  }
  const stamped = {
    ...props,
    [CHORD_SOURCE_ATTRIBUTE]: `${source.fileName}:${source.lineNumber}:${source.columnNumber}`,
  };
  return create(type, stamped, key);
}

export const jsxRuntimeWithSourceStamps = { Fragment, jsx, jsxs, jsxDEV };
