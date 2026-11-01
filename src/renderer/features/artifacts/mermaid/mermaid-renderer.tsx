import type { Mermaid } from 'mermaid';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { SvgCache } from './svg-cache';

/**
 * The single source of truth for turning mermaid text into a rendered diagram.
 * Both the Tiptap `mermaidDiagram` node view and the MDX `<MermaidDiagram>`
 * component render through this — there is intentionally only one place that
 * calls `mermaid.render()`.
 *
 * Rendering is read-only: the diagram source lives as a ```mermaid fence in the
 * document, and edits happen by commenting → the agent rewrites the fence. See
 * the diagram rendering design.
 */

type RenderState =
  | { status: 'loading' }
  | { status: 'rendered'; svg: string }
  | { status: 'error'; message: string };

let mermaidInstance: Mermaid | null = null;
let initPromise: Promise<void> | null = null;
let diagramCounter = 0;

const SVG_CACHE_LIMIT = 32;
const svgCache = new SvgCache(SVG_CACHE_LIMIT);

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

interface MermaidRendererProps {
  code: string;
  caption?: string;
}

export function MermaidRenderer({ code, caption }: MermaidRendererProps) {
  return (
    <ErrorBoundary
      fallbackRender={({ error }) => (
        <MermaidErrorCard
          message={error instanceof Error ? error.message : String(error)}
          code={code}
        />
      )}
    >
      <MermaidCanvas code={code} caption={caption} />
    </ErrorBoundary>
  );
}

function MermaidCanvas({ code, caption }: MermaidRendererProps) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'chord-dark';
  const cacheKey = `${isDark ? 'dark' : 'default'}:${code}`;

  const [state, setState] = useState<RenderState>(() => {
    const cached = svgCache.read(cacheKey);
    return cached ? { status: 'rendered', svg: cached } : { status: 'loading' };
  });

  useEffect(() => {
    const cached = svgCache.read(cacheKey);
    if (cached) {
      setState({ status: 'rendered', svg: cached });
      return;
    }

    if (!code.trim()) {
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
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'strict',
          fontFamily: 'inherit',
        });
        const { svg } = await mermaid.render(`mermaid-${++diagramCounter}`, code.trim());
        if (cancelled) return;
        svgCache.write(cacheKey, svg);
        setState({ status: 'rendered', svg });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to render diagram',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, isDark]);

  if (state.status === 'error') {
    return <MermaidErrorCard message={state.message} code={code} />;
  }

  return (
    <div className="mermaid-container my-3">
      {state.status === 'loading' ? (
        <div className="flex items-center justify-center p-8 text-body tracking-body text-text-passive">
          <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-25"
            />
            <path
              d="M4 12a8 8 0 018-8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="opacity-75"
            />
          </svg>
          Rendering diagram…
        </div>
      ) : (
        <div
          className="mermaid-svg flex justify-center rounded-lg border border-border bg-surface-raised p-4"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
      {caption && (
        <div className="mt-1 text-center text-tiny tracking-tiny text-text-passive">{caption}</div>
      )}
    </div>
  );
}

function MermaidErrorCard({ message, code }: { message: string; code: string }) {
  return (
    <div className="my-3 flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4">
      <span className="text-tiny tracking-tiny font-medium text-text-muted">
        Mermaid diagram error
      </span>
      <pre className="max-h-24 overflow-auto rounded bg-surface-inset p-2 text-tiny tracking-tiny text-text-passive">
        {message}
      </pre>
      <pre className="max-h-32 overflow-auto rounded bg-surface-inset p-2 text-tiny tracking-tiny text-text-passive">
        {code}
      </pre>
    </div>
  );
}
