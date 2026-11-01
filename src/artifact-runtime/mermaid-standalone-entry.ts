import mermaid from 'mermaid';

/**
 * Entry of `mermaid-standalone.js`: mermaid as one classic script that a page
 * view inlines when its bundle renders a diagram. The standalone runtime reads
 * it through `mermaid-window-shim.ts`.
 */
(window as unknown as { mermaid: typeof mermaid }).mermaid = mermaid;
