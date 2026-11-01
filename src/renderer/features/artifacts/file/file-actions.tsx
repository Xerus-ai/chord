import { Download, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { describeFileSize } from '@shared/artifact-file-types';
import { rpc } from '@renderer/lib/ipc';
import type { ArtifactFileTarget } from './file-target';

const ACTION_CLASS =
  'inline-flex h-[26px] flex-shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border bg-transparent px-2 text-tiny tracking-tiny font-semibold text-text-muted transition-colors hover:border-border-strong hover:text-text disabled:cursor-default disabled:opacity-60';

/**
 * "Open" in the system's default app and "Save a copy" for a binary artifact
 * (design 2026-09-24 §10). A failure is shown beside the buttons, never
 * swallowed.
 */
export function FileActions({ target }: { target: ArtifactFileTarget }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run(action: 'open' | 'saveCopy') {
    setBusy(true);
    setFailure(null);
    try {
      const result = await rpc.artifactFiles[action](target);
      if (!result.success) setFailure(result.error.message);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {failure && (
        <span role="alert" className="text-tiny tracking-tiny text-status-err">
          {failure}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void run('open')}
        className={ACTION_CLASS}
      >
        <ExternalLink className="h-3 w-3" />
        Open
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run('saveCopy')}
        className={ACTION_CLASS}
      >
        <Download className="h-3 w-3" />
        Save a copy
      </button>
    </div>
  );
}

/** The one-line description of a file: name, size and which copy is shown. */
export function describeShownFile(file: {
  fileName: string;
  byteSize: number;
  versionNumber: number | null;
}): string {
  const copy = file.versionNumber !== null ? `version ${file.versionNumber}` : 'on this device';
  return `${file.fileName} · ${describeFileSize(file.byteSize)} · ${copy}`;
}
