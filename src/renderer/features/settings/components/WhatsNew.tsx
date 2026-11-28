import React from 'react';
import { useFeatureFlag } from '@renderer/lib/feature-flags/use-feature-flag';
import { useUpdateStore } from '@renderer/lib/stores/update-store';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';

/** While an update is found, downloading or ready: its notes are what's new. */
const SHOWN_WHILE = new Set(['available', 'downloading', 'downloaded', 'installing']);

/**
 * What's new (devstation-haay, design F21): the release notes the update manifest carries, under
 * the version they belong to. Behind feature flag whats_new (devstation-mg6u.90); nothing at all
 * without an update found or without notes.
 */
export function WhatsNew(): React.JSX.Element | null {
  const enabled = useFeatureFlag('whats_new');
  const status = useUpdateStore((s) => s.state.status);
  const version = useUpdateStore((s) => s.availableVersion);
  const notes = useUpdateStore((s) => s.releaseNotes);
  if (!enabled || !notes || !version || !SHOWN_WHILE.has(status)) return null;
  return (
    <section aria-label={`What's new in v${version}`} className="grid gap-2">
      <p className="text-body tracking-body text-text">What&apos;s new in v{version}</p>
      <MarkdownRenderer
        content={notes}
        variant="compact"
        htmlAsText
        className="max-h-60 overflow-y-auto rounded-md bg-surface-raised px-3 py-2 text-body tracking-body text-text-muted"
      />
    </section>
  );
}
