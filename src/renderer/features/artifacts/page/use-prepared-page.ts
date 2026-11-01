import { useCallback, useEffect, useState } from 'react';
import type { PageTheme } from '@shared/artifact-frame-constants';
import {
  artifactContentUpdateChannel,
  type ArtifactContentUpdate,
} from '@shared/events/artifactEvents';
import { events, rpc } from '@renderer/lib/ipc';

export type PageTarget =
  | { kind: 'artifact'; artifactId: string }
  | { kind: 'artifact-version'; artifactId: string; versionId: string; content: string }
  | { kind: 'embedded-mdx'; filePath: string; workItemId: string }
  /** A repo file that is no artifact, previewed as a page (design 2026-09-26 §3). */
  | { kind: 'repo-file'; workItemId: string; filePath: string; worktreeId?: string };

export interface PreparedPage {
  /** The frame URL once main has registered and, if needed, compiled the page. */
  url: string | null;
  loading: boolean;
  /** Why the page could not be prepared — a missing file, a compile error. */
  error: string | null;
  reload: () => void;
}

function matchesUpdate(target: PageTarget, update: ArtifactContentUpdate): boolean {
  if (target.kind === 'artifact') return update.artifactId === target.artifactId;
  // A stored version is immutable; the file changing on disk does not affect it.
  if (target.kind === 'artifact-version') return false;
  // Updates are artifact writes; a repo file re-prepares when its tab shows it again.
  if (target.kind === 'repo-file') return false;
  return (
    update.workItemId === target.workItemId &&
    update.filePath.toLowerCase() === target.filePath.toLowerCase()
  );
}

function targetKeyOf(target: PageTarget): string {
  switch (target.kind) {
    case 'artifact':
      return `artifact:${target.artifactId}`;
    case 'artifact-version':
      return `version:${target.artifactId}:${target.versionId}`;
    case 'embedded-mdx':
      return `mdx:${target.workItemId}:${target.filePath}`;
    case 'repo-file':
      return `repo:${target.workItemId}:${target.worktreeId ?? ''}:${target.filePath}`;
  }
}

function requestPrepare(target: PageTarget, theme: PageTheme) {
  switch (target.kind) {
    case 'artifact':
      return rpc.artifactPages.prepare({ artifactId: target.artifactId, theme });
    case 'artifact-version':
      return rpc.artifactPages.prepareVersion({
        artifactId: target.artifactId,
        versionId: target.versionId,
        content: target.content,
        theme,
      });
    case 'embedded-mdx':
      return rpc.artifactPages.prepareEmbeddedMdx({
        filePath: target.filePath,
        workItemId: target.workItemId,
        theme,
      });
    case 'repo-file':
      return rpc.artifactPages.prepareRepoFile({
        workItemId: target.workItemId,
        filePath: target.filePath,
        worktreeId: target.worktreeId,
        theme,
      });
  }
}

/**
 * Asks main to prepare a page and hands back its URL. Preparation is where a
 * `.tsx` prototype or `.mdx` component is compiled, so a build failure lands
 * here as `error` and the host renders an error state instead of a frame.
 * The page is re-prepared — and the frame reloads through a fresh URL — when
 * main reports that the file behind it changed. The theme on the URL is the
 * one current at (re)load time; switches in between are pushed by PageFrame.
 *
 * `isOwnWrite` lets the caller claim a change it made itself and already
 * shows (an in-place edit), so that change does not reload the frame.
 */
export function usePreparedPage(
  target: PageTarget,
  theme: PageTheme,
  options: { isOwnWrite?: (update: ArtifactContentUpdate) => boolean } = {}
): PreparedPage {
  const { isOwnWrite } = options;
  const [state, setState] = useState<{
    url: string | null;
    error: string | null;
    loading: boolean;
  }>({ url: null, error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  const targetKey = targetKeyOf(target);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    requestPrepare(target, theme)
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          setState({ url: null, error: result.error.message, loading: false });
          return;
        }
        // A reload must produce a new URL or React keeps the old frame; the
        // attempt counter rides along as a query parameter the page ignores.
        const url = new URL(result.data.url);
        url.searchParams.set('v', String(attempt));
        setState({ url: url.toString(), error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ url: null, error: e instanceof Error ? e.message : String(e), loading: false });
      });

    return () => {
      cancelled = true;
    };
    // targetKey stands in for the target object, which callers rebuild per
    // render; theme is read at load time only (see the docblock).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const off = events.on(artifactContentUpdateChannel, (update: ArtifactContentUpdate) => {
      if (!matchesUpdate(target, update)) return;
      if (isOwnWrite?.(update)) return;
      reload();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, reload, isOwnWrite]);

  return { url: state.url, loading: state.loading, error: state.error, reload };
}
