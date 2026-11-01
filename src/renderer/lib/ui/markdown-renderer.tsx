import React, { useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
// Async light build: each Prism grammar is its own chunk, loaded the first
// time a block in that language renders (shown plain until then). The full
// `Prism` export put every grammar (refractor, ~865 KB of source) into the
// startup bundle.
import { PrismAsyncLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { PluggableList } from 'unified';
import { filePathTab } from '@renderer/features/work-list/center-tab';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { resolveFileReference } from '@renderer/lib/ui/file-reference';
import { buildMarkdownPlugins, type MarkdownVariant } from '@renderer/lib/ui/markdown-pipeline';
import { resolvePrismLanguage } from '@renderer/lib/ui/prism-language';
import { useRepoFilesContext } from '@renderer/lib/ui/repo-files-context';
import { cn } from '@renderer/utils/utils';

interface MarkdownRendererProps {
  content: string;
  variant?: MarkdownVariant;
  /** Text a person typed: `<…>` in it renders as written, not as markup. */
  htmlAsText?: boolean;
  className?: string;
  /**
   * Optional callback for resolving non-external image src values (e.g. relative
   * paths inside a workspace). Should return a `data:` URI string, or `null` to
   * render a "not found" placeholder. When omitted, local images are not resolved.
   */
  resolveImage?: (src: string) => Promise<string | null>;
  /**
   * Extra rehype plugins, appended after sanitization so a caller can decorate
   * the sanitized tree (chat's mention pills). Must be referentially stable —
   * it participates in the memo comparison below.
   */
  extraRehypePlugins?: PluggableList;
}

/** Resolves a local image src via the provided callback and renders as a base64 data URI. */
const ResolvedImage: React.FC<{
  src: string;
  alt: string;
  resolveImage: (src: string) => Promise<string | null>;
}> = ({ src, alt, resolveImage }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolveImage(src)
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setDataUrl(result);
        } else {
          setError(true);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [src, resolveImage]);

  if (error) {
    return (
      <span className="my-3 inline-block text-tiny tracking-tiny text-text-muted">
        [Image not found: {src}]
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <span className="my-3 inline-block text-tiny tracking-tiny text-text-muted">
        Loading image...
      </span>
    );
  }
  return <img src={dataUrl} alt={alt} className="my-3 max-w-full rounded" />;
};

type WithChildren = { children?: React.ReactNode };
type WithChildrenAndClass = { children?: React.ReactNode; className?: string };
type AnchorProps = { href?: string; children?: React.ReactNode };
type ImgProps = { src?: string; alt?: string };

/**
 * Inline code that resolves to a real repo file renders as a click-to-open
 * link into the file-viewer tab (chord:switch-tab is handled by the
 * work-item surface). Anything else renders as plain inline code.
 */
function InlineCode({
  children,
  repoFiles,
  codeClassName,
}: {
  children: React.ReactNode;
  repoFiles: ReadonlySet<string> | null;
  codeClassName: string;
}) {
  const text = typeof children === 'string' ? children : null;
  const ref = text && repoFiles ? resolveFileReference(text, repoFiles) : null;

  if (!ref) return <code className={codeClassName}>{children}</code>;

  return (
    <code
      role="link"
      tabIndex={0}
      title={`Open ${ref.path}`}
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent('chord:switch-tab', {
            detail: filePathTab(ref.path, { line: ref.line }),
          })
        )
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent('chord:switch-tab', {
              detail: filePathTab(ref.path, { line: ref.line }),
            })
          );
        }
      }}
      className={cn(
        codeClassName,
        'cursor-pointer text-text underline decoration-text/40 underline-offset-2 hover:decoration-text'
      )}
    >
      {children}
    </code>
  );
}

function useFullComponents(
  isDark: boolean,
  repoFiles: ReadonlySet<string> | null,
  resolveImage?: (src: string) => Promise<string | null>
) {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h1 className="mb-4 mt-6 border-b border-border pb-2 text-display tracking-display font-semibold text-text first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }: WithChildren) => (
        <h2 className="mb-3 mt-6 border-b border-border pb-2 text-title tracking-title font-semibold text-text first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }: WithChildren) => (
        <h3 className="mb-2 mt-4 text-title tracking-title font-semibold text-text">{children}</h3>
      ),
      /* The app tier offers three steps above nothing (22/15/13/11) for six
         heading levels, so below h3 the ladder descends by colour and then by
         size. Every adjacent pair differs in at least one property: h2 and h3
         share a size but only h2 carries the bottom rule. */
      h4: ({ children }: WithChildren) => (
        <h4 className="mb-2 mt-4 text-body tracking-body font-semibold text-text">{children}</h4>
      ),
      h5: ({ children }: WithChildren) => (
        <h5 className="mb-1 mt-3 text-body tracking-body font-semibold text-text-muted">
          {children}
        </h5>
      ),
      h6: ({ children }: WithChildren) => (
        <h6 className="mb-1 mt-3 text-tiny tracking-tiny font-semibold text-text-muted">
          {children}
        </h6>
      ),
      p: ({ children }: WithChildren) => (
        <p className="mb-3 text-content tracking-body leading-relaxed text-text">{children}</p>
      ),
      /* Accent markers: the bullet is the agent's voice punctuating its own
         prose, and tinting it is what stops a list reading as a wall. */
      ul: ({ children }: WithChildren) => (
        <ul className="mb-3 ml-6 list-disc space-y-1 text-content tracking-body text-text marker:text-text">
          {children}
        </ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="mb-3 ml-6 list-decimal space-y-1 text-content tracking-body text-text marker:text-text">
          {children}
        </ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-relaxed">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';
        const isBlock = className?.includes('language-');

        if (isBlock) {
          const codeStr = String(children ?? '').replace(/\n$/, '');
          // Don't render empty code blocks (can happen after mdx-component tag stripping)
          if (!codeStr.trim()) return null;
          return (
            <SyntaxHighlighter
              style={isDark ? oneDark : oneLight}
              language={resolvePrismLanguage(language)}
              PreTag="div"
              className="!my-0 !rounded-md !text-code"
            >
              {codeStr}
            </SyntaxHighlighter>
          );
        }

        return (
          <InlineCode
            repoFiles={repoFiles}
            codeClassName="rounded-[4.5px] bg-surface-active px-1.5 py-0.5 text-code text-text"
          >
            {children}
          </InlineCode>
        );
      },
      pre: ({ children }: WithChildren) => {
        // Don't render empty pre blocks (can happen when code block content was stripped)
        if (!children) return null;
        return (
          <pre className="mb-3 overflow-x-auto rounded-md border border-border">{children}</pre>
        );
      },
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp) {
            e.preventDefault();
            rpc.app.openExternal(href).catch(() => {});
          }
        };
        return (
          <a
            href={href}
            className="text-text underline decoration-text/50 hover:decoration-text"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
      blockquote: ({ children }: WithChildren) => (
        <blockquote className="mb-3 rounded-r-sm border-l-2 border-border-strong bg-surface-active py-1.5 pl-3 pr-2.5 text-content tracking-body text-text-muted">
          {children}
        </blockquote>
      ),
      table: ({ children }: WithChildren) => (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full border-collapse text-body tracking-body">{children}</table>
        </div>
      ),
      thead: ({ children }: WithChildren) => (
        <thead className="border-b border-border bg-surface-inset">{children}</thead>
      ),
      th: ({ children }: WithChildren) => (
        <th className="px-3 py-2 text-left font-semibold text-text">{children}</th>
      ),
      td: ({ children }: WithChildren) => (
        <td className="border-t border-border px-3 py-2 text-text">{children}</td>
      ),
      hr: () => <hr className="my-6 border-border" />,
      img: ({ src, alt }: ImgProps) => {
        const isExternal = typeof src === 'string' && /^https?:\/\//i.test(src);
        if (!isExternal && resolveImage && src) {
          return <ResolvedImage src={src} alt={alt || ''} resolveImage={resolveImage} />;
        }
        return <img src={src} alt={alt || ''} className="my-3 max-w-full rounded" />;
      },
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-text">{children}</strong>
      ),
      input: ({ checked, ...props }: React.ComponentPropsWithoutRef<'input'>) => (
        <input
          type="checkbox"
          checked={checked}
          disabled
          className="mr-2 align-middle"
          {...props}
        />
      ),
    }),
    [isDark, repoFiles, resolveImage]
  );
}

function useCompactComponents(repoFiles: ReadonlySet<string> | null) {
  return useMemo(
    () => ({
      h1: ({ children }: WithChildren) => (
        <h2 className="mb-1 mt-3 text-body tracking-body font-semibold text-text first:mt-0">
          {children}
        </h2>
      ),
      h2: ({ children }: WithChildren) => (
        <h3 className="mb-1 mt-3 text-body tracking-body font-semibold text-text first:mt-0">
          {children}
        </h3>
      ),
      h3: ({ children }: WithChildren) => (
        <h4 className="mb-1 mt-2 text-tiny tracking-tiny font-semibold text-text">{children}</h4>
      ),
      p: ({ children }: WithChildren) => <p className="mb-2 leading-[1.4] last:mb-0">{children}</p>,
      ul: ({ children }: WithChildren) => (
        <ul className="mb-2 ml-4 list-disc space-y-0.5 marker:text-text">{children}</ul>
      ),
      ol: ({ children }: WithChildren) => (
        <ol className="mb-2 ml-4 list-decimal space-y-0.5 marker:text-text">{children}</ol>
      ),
      li: ({ children }: WithChildren) => <li className="leading-[1.4]">{children}</li>,
      code: ({ children, className }: WithChildrenAndClass) => {
        const isBlock = className?.includes('language-');
        return isBlock ? (
          <code className="block overflow-x-auto rounded bg-surface-inset p-2 text-tiny tracking-tiny">
            {children}
          </code>
        ) : (
          <InlineCode
            repoFiles={repoFiles}
            codeClassName="rounded-[4.5px] bg-surface-active px-1 py-0.5 text-tiny tracking-tiny text-text"
          >
            {children}
          </InlineCode>
        );
      },
      pre: ({ children }: WithChildren) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
      strong: ({ children }: WithChildren) => (
        <strong className="font-semibold text-text">{children}</strong>
      ),
      a: ({ href, children }: AnchorProps) => {
        const isHttp = typeof href === 'string' && /^https?:\/\//i.test(href);
        const handleClick = (e: React.MouseEvent) => {
          if (isHttp) {
            e.preventDefault();
            rpc.app.openExternal(href).catch(() => {});
          }
        };
        return (
          <a
            href={href}
            className="text-text underline"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
    }),
    [repoFiles]
  );
}

/**
 * Agents were once told to embed `<mdx-component>` tags in their replies. The
 * protocol is gone (agents publish through the chord `publish_artifact` tool),
 * but transcripts persisted before then still carry the tags; they are markup,
 * not prose, so they are dropped from what renders.
 */
function stripMdxComponentTags(text: string): string {
  if (!text.includes('mdx-component')) return text;
  return text.replace(/<\/?mdx-component\b[^>]*\/?>/gi, '').replace(/\n{3,}/g, '\n\n');
}

const MarkdownRendererComponent: React.FC<MarkdownRendererProps> = ({
  content,
  variant = 'full',
  htmlAsText = false,
  className,
  resolveImage,
  extraRehypePlugins,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'chord-dark';
  const repoFiles = useRepoFilesContext();

  const fullComponents = useFullComponents(isDark, repoFiles, resolveImage);
  const compactComponents = useCompactComponents(repoFiles);

  const components = variant === 'full' ? fullComponents : compactComponents;
  const { remarkPlugins, rehypePlugins } = buildMarkdownPlugins({
    variant,
    htmlAsText,
    extraRehypePlugins,
  });

  const cleaned = stripMdxComponentTags(content);

  return (
    <div className={cn(className)}>
      <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {cleaned}
      </Markdown>
    </div>
  );
};

// resolveImage intentionally omitted — only used in full-variant workspace views where the callback is stable via useCallback
export const MarkdownRenderer = React.memo(MarkdownRendererComponent, (prev, next) => {
  return (
    prev.content === next.content &&
    prev.variant === next.variant &&
    prev.htmlAsText === next.htmlAsText &&
    prev.className === next.className &&
    prev.extraRehypePlugins === next.extraRehypePlugins
  );
});
