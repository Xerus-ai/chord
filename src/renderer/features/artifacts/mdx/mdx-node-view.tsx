import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useCallback, useState } from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useArtifactSource } from '../artifact-source-context';
import { PageFrame } from '../page/page-frame';
import { usePreparedPage } from '../page/use-prepared-page';
import { MdxErrorFallback, MdxLoading } from './mdx-fallbacks';

/**
 * An `<mdx-component data-path>` block inside a document. The component is
 * bundled in main and rendered inside an opaque-origin sandbox frame served
 * over `chord-artifact://` — never executed in this document, which holds the
 * preload bridge. The frame reports its height so the block sizes to content.
 *
 * The component file exists only on the author's device, so a document read
 * from the cloud names it instead of trying to build it (design §9 decision 2).
 */
export function MdxNodeView(props: ReactNodeViewProps) {
  const source = useArtifactSource();
  const componentPath = props.node.attrs['data-path'] as string | null;
  const workItemId = props.node.attrs['data-work-item-id'] as string | null;

  if (source === 'cloud') {
    return (
      <NodeViewWrapper>
        <div className="rounded-lg border border-border bg-surface-inset px-4 py-3 text-body tracking-body text-text-passive">
          Interactive component{componentPath ? ` (${componentPath})` : ''} — open it on the
          author's device.
        </div>
      </NodeViewWrapper>
    );
  }

  if (!componentPath || !workItemId) {
    return (
      <NodeViewWrapper>
        <MdxErrorFallback
          error={
            componentPath
              ? 'mdx-component is missing data-work-item-id'
              : 'No data-path attribute on mdx-component'
          }
          onDelete={props.deleteNode}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <EmbeddedMdxFrame
        filePath={componentPath}
        workItemId={workItemId}
        onDelete={props.deleteNode}
      />
    </NodeViewWrapper>
  );
}

function EmbeddedMdxFrame({
  filePath,
  workItemId,
  onDelete,
}: {
  filePath: string;
  workItemId: string;
  onDelete: () => void;
}) {
  const { effectiveTheme } = useTheme();
  const { url, loading, error, reload } = usePreparedPage(
    { kind: 'embedded-mdx', filePath, workItemId },
    effectiveTheme
  );
  const [pageError, setPageError] = useState<string | null>(null);
  const handlePageError = useCallback((message: string) => setPageError(message), []);

  if (error) return <MdxErrorFallback error={error} onDelete={onDelete} />;
  if (pageError) return <MdxErrorFallback error={pageError} onDelete={onDelete} />;
  if (loading || !url) return <MdxLoading />;

  return (
    <div className="mdx-component-root overflow-hidden rounded-lg border border-border bg-surface">
      <PageFrame
        key={url}
        url={url}
        theme={effectiveTheme}
        title={filePath}
        sizing="content"
        onPageError={handlePageError}
        onNavigationBlocked={reload}
      />
    </div>
  );
}
