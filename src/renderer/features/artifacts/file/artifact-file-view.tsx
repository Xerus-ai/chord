import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { describeFileSize } from '@shared/artifact-file-types';
import { PAGE_THEME_QUERY_PARAM } from '@shared/artifact-frame-constants';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { ArtifactLoadError } from '../artifact-load-error';
import { PageFrame } from '../page/page-frame';
import { describeShownFile, FileActions } from './file-actions';
import type { ArtifactFileTarget } from './file-target';

interface ArtifactFileViewProps {
  /** Which copy to show: the author's, the cloud's, or a public link's. */
  target: ArtifactFileTarget;
  title: string;
  /** Changes when a new version arrives, so the file is prepared again. */
  reloadKey: string | number;
}

/**
 * A binary artifact — pdf, docx, pptx or image (design 2026-09-24 §10). Main
 * prepares the copy to show (the author's file, or the uploaded bytes) and
 * says how: an image or docx is its view in the page sandbox; a pdf is its own
 * bytes in a frame WITHOUT the sandbox attribute, because Chromium's PDF
 * viewer is blocked inside one — the response's CSP still sandboxes it to an
 * opaque origin; a pptx is a card. Nothing here edits the file.
 */
export function ArtifactFileView({ target, title, reloadKey }: ArtifactFileViewProps) {
  const { effectiveTheme } = useTheme();

  const query = useQuery({
    queryKey: ['artifactFile', target, reloadKey],
    queryFn: () => rpc.artifactFiles.prepare(target),
    staleTime: Infinity,
  });

  const failure = query.error
    ? query.error.message
    : query.data && !query.data.success && query.data.error.type !== 'no_file'
      ? query.data.error.message
      : null;
  if (failure !== null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ArtifactLoadError
          message={`The file could not be loaded: ${failure}`}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  if (!query.data) return <CenteredNote text="Preparing file…" />;
  if (!query.data.success) return <CenteredNote text={query.data.error.message} />;

  const file = query.data.data;
  const frameUrl = file.url === null ? null : withTheme(file.url, effectiveTheme);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="artifact-file-view">
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-1.5">
        <span className="min-w-0 flex-1 truncate text-tiny tracking-tiny text-text-passive">
          {describeShownFile(file)}
        </span>
        <FileActions target={target} />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col" data-file-viewer={file.viewer}>
        {file.viewer === 'view' && frameUrl && (
          <PageFrame
            key={frameUrl}
            url={frameUrl}
            theme={effectiveTheme}
            title={title}
            sizing="fill"
            mode="view"
          />
        )}
        {file.viewer === 'pdf' && frameUrl && (
          <iframe
            key={frameUrl}
            src={frameUrl}
            title={title}
            referrerPolicy="no-referrer"
            className="block h-full w-full flex-1 border-0 bg-surface"
          />
        )}
        {file.viewer === 'card' && (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="flex w-[320px] flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center">
              <FileText className="h-8 w-8 text-text-passive" />
              <div className="text-body tracking-body font-semibold text-text">{file.fileName}</div>
              <div className="text-tiny tracking-tiny text-text-passive">
                {describeFileSize(file.byteSize)} · open it to see the slides
              </div>
              <FileActions target={target} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function withTheme(url: string, theme: string): string {
  const themed = new URL(url);
  themed.searchParams.set(PAGE_THEME_QUERY_PARAM, theme);
  return themed.toString();
}

function CenteredNote({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8 text-center text-body tracking-body text-text-passive">
      {text}
    </div>
  );
}
