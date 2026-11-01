import { useEffect, useRef } from 'react';
import { GenerateButton, GitAiFailureNotice } from '@renderer/features/git-ai/generate-button';
import { Button } from '@renderer/lib/ui/button';
import type { BandModel } from './use-band-model';

/**
 * The commit message, as a popover hanging off the band's button.
 *
 * It lives here rather than pinned to the bottom of Changes because committing
 * is a work-item action, not a Changes-tab action: the band offers it from
 * whichever tab is open, and a box that is only reachable from one tab made
 * "Commit" mean something different depending on where you were standing.
 */
export function CommitPopover({
  message,
  onMessageChange,
  fileCount,
  running,
  generation,
  onCommit,
  onDismiss,
}: {
  message: string;
  onMessageChange: (message: string) => void;
  fileCount: number;
  running: boolean;
  /** Git AI's Generate: the only writer of the message besides the user. */
  generation: BandModel['commitGeneration'];
  onCommit: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss]);

  const ready = message.trim().length > 0 && fileCount > 0 && !running;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Commit message"
      className="absolute right-2 top-[46px] z-20 w-[300px] rounded-xl bg-surface-raised p-2.5 shadow-lg ring-1 ring-text/10"
    >
      <textarea
        ref={input}
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready) onCommit();
        }}
        readOnly={generation.generating}
        placeholder="Commit message"
        aria-label="Commit message"
        rows={3}
        className="w-full resize-none rounded-lg border border-border bg-surface px-2 py-1.5 text-list-row text-text outline-none placeholder:text-text-passive focus:border-border-strong"
      />
      {generation.failure && (
        <div className="mt-1.5">
          <GitAiFailureNotice failure={generation.failure} onDismiss={generation.dismissFailure} />
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <GenerateButton
          agent={generation.agent}
          generating={generation.generating}
          onGenerate={generation.start}
          onCancel={generation.cancel}
        />
        <span className="flex-1" />
        <Button size="sm" disabled={!ready} onClick={onCommit}>
          {running ? 'Committing…' : `Commit ${fileCount} file${fileCount === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
