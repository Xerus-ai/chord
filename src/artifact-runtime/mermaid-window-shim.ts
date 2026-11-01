import type { Mermaid } from 'mermaid';

/**
 * What `import('mermaid')` resolves to inside `runtime-standalone.js`, the
 * runtime a page's self-contained view inlines (design 2026-09-24 §9). There
 * is no chunk to fetch there: the view carries `mermaid-standalone.js` as its
 * own script, which sets `window.mermaid`, and only when the page uses a
 * diagram. `mermaid-diagram.tsx` reads `mod.default`, so the default export
 * forwards every property read to `window.mermaid` at the moment it is read —
 * never at module evaluation, which happens before the mermaid script may
 * have run.
 */
function loadedMermaid(): Mermaid {
  const loaded = (window as unknown as { mermaid?: Mermaid }).mermaid;
  if (!loaded) {
    throw new Error('mermaid is not loaded in this page (mermaid-standalone.js is missing)');
  }
  return loaded;
}

const mermaid = new Proxy({} as Mermaid, {
  get: (_target, property) => loadedMermaid()[property as keyof Mermaid],
});

export default mermaid;
