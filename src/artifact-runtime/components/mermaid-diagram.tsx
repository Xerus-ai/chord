import type { Mermaid } from 'mermaid';
import { useEffect, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
  caption?: string;
}

type RenderState =
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string };

let mermaidInstance: Mermaid | null = null;
let initPromise: Promise<void> | null = null;
let diagramCounter = 0;

/**
 * mermaid is a code-split chunk of the vendored runtime, loaded the first time
 * a diagram renders. `securityLevel: 'strict'` keeps its own HTML sanitiser on;
 * the frame CSP is the outer wall.
 */
async function ensureMermaid(): Promise<Mermaid> {
  if (mermaidInstance) return mermaidInstance;
  if (!initPromise) {
    initPromise = import('mermaid').then((mod) => {
      mermaidInstance = mod.default;
    });
  }
  await initPromise;
  return mermaidInstance!;
}

function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('chord-dark');
}

export function MermaidDiagram({ chart, caption }: MermaidDiagramProps) {
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [dark, setDark] = useState(isDarkTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(isDarkTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!chart.trim()) {
      setState({ status: 'error', message: 'Empty mermaid diagram' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const mermaid = await ensureMermaid();
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(`chord-mermaid-${++diagramCounter}`, chart.trim());
        if (!cancelled) setState({ status: 'rendered', svg });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to render diagram',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, dark]);

  if (state.status === 'error') {
    return (
      <div className="chord-mermaid chord-mermaid-error" role="alert">
        <div className="chord-mermaid-error-title">Diagram failed to render</div>
        <pre className="chord-mermaid-error-message">{state.message}</pre>
        <pre className="chord-mermaid-error-source">{chart}</pre>
      </div>
    );
  }

  return (
    <figure className="chord-mermaid">
      {state.status === 'loading' ? (
        <div className="chord-mermaid-loading">Rendering diagram…</div>
      ) : (
        // mermaid's output under securityLevel 'strict' is sanitised SVG.
        <div className="chord-mermaid-svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
      )}
      {caption && <figcaption className="chord-mermaid-caption">{caption}</figcaption>}
    </figure>
  );
}
