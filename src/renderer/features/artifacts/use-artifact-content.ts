import { useCallback, useEffect, useState } from 'react';
import {
  renderClassForArtifactType,
  type ArtifactRenderClass,
} from '@shared/artifact-render-class';
import {
  artifactContentUpdateChannel,
  type ArtifactContentUpdate,
} from '@shared/events/artifactEvents';
import type { ArtifactType } from '@shared/stream-items';
import { events, rpc } from '@renderer/lib/ipc';
import { markdownToHtml } from './markdown';

interface UseArtifactContentResult {
  content: string;
  loading: boolean;
  /** Why the artifact could not be read, when it could not be read. */
  error: string | null;
  /** Re-run the load after a failure. */
  retry: () => void;
  setContent: (html: string) => void;
  /**
   * How the artifact is put on screen. `null` until the row has loaded, so the
   * workspace never mounts the wrong surface for a frame.
   */
  renderClass: ArtifactRenderClass | null;
  /** The artifact's format; `null` until the row has loaded. */
  artifactType: ArtifactType | null;
  /** The row has been delivered to the cloud (`cloud_id` set); false until loaded. */
  hasCloudCopy: boolean;
}

interface LoadedArtifact {
  content: string | null;
  filePath: string | null;
  contentType: string | null;
  type: ArtifactType;
  cloudId: string | null;
}

function describeError(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}

/**
 * The artifact body, or a thrown error explaining why there isn't one. A read
 * that fails must never resolve to an empty string: the editor cannot tell that
 * apart from a genuinely empty document, and the user was left staring at a
 * blank page with no indication anything had gone wrong.
 */
async function readArtifactBody(artifact: LoadedArtifact, workItemId: string): Promise<string> {
  // File-backed artifacts read the file first — the row's `content` is a
  // snapshot that may trail the disk. The main side falls back to that
  // snapshot itself when the file is gone, so a miss here means neither the
  // file nor a saved copy exists.
  if (!artifact.filePath) return artifact.content ?? '';

  const fileResult = await rpc.artifacts.readFileContent({
    filePath: artifact.filePath,
    workItemId,
  });
  if (!fileResult.success) {
    // Only a missing file may fall back to the row snapshot — the main side
    // already tried its own snapshot for that case, so this covers rows whose
    // content arrived via sync rather than a local write. A read *failure*
    // (permissions, I/O) must surface, not silently serve a stale copy.
    if (fileResult.error.type === 'not_found' && artifact.content) return artifact.content;
    throw new Error(
      `Could not read ${artifact.filePath} — ${describeError(fileResult.error)}. The agent may not have written it yet, or it may have moved.`
    );
  }
  return fileResult.data.content;
}

/**
 * The author's own artifact, read from the local database and file. Only a
 * `local` workspace enables it; a cloud workspace never touches local rows.
 */
export function useArtifactContent(
  artifactId: string,
  workItemId: string,
  enabled: boolean
): UseArtifactContentResult {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderClass, setRenderClass] = useState<ArtifactRenderClass | null>(null);
  const [artifactType, setArtifactType] = useState<ArtifactType | null>(null);
  const [hasCloudCopy, setHasCloudCopy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const result = await rpc.artifacts.get(artifactId);
        if (cancelled) return;
        if (!result.success) {
          throw new Error(`Could not open this artifact — ${describeError(result.error)}.`);
        }

        const artifact = result.data.artifact as LoadedArtifact;
        const artifactRenderClass = renderClassForArtifactType(artifact.type);
        setRenderClass(artifactRenderClass);
        setArtifactType(artifact.type);
        setHasCloudCopy(artifact.cloudId !== null);

        // A file (pdf, docx, pptx, image — design §10) is bytes, never text:
        // main prepares it for its viewer, so nothing is read here.
        if (artifactRenderClass === 'file') {
          setContent('');
          return;
        }

        // A page's `content` is its source text: it is what a manual version
        // snapshots, and nothing here converts it — the page renders in its
        // own sandboxed frame, not in the editor. MDX is a page too.
        if (artifactRenderClass === 'page') {
          const source = await readArtifactBody(artifact, workItemId);
          if (cancelled) return;
          setContent(source);
          return;
        }

        const raw = await readArtifactBody(artifact, workItemId);
        if (cancelled) return;
        setContent(raw ? markdownToHtml(raw) : '');
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        console.error('[artifact] load failed:', e);
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [artifactId, workItemId, attempt, enabled]);

  const handleUpdate = useCallback((html: string) => {
    setContent(html);
  }, []);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  // A page's `content` is its source, which changes on disk — an agent write,
  // an in-place edit, or any other program writing the file, which main's
  // watch reports while this tab holds it. Documents are kept current by
  // their editor instead.
  useEffect(() => {
    if (!enabled || renderClass !== 'page') return;
    const off = events.on(artifactContentUpdateChannel, (update: ArtifactContentUpdate) => {
      if (update.artifactId === artifactId) setContent(update.content);
    });
    void rpc.artifacts.watchFile({ artifactId, workItemId }).then((result) => {
      if (!result.success) console.error('[artifacts] watching the page file failed:', result);
    });
    return () => {
      off();
      void rpc.artifacts.unwatchFile({ artifactId });
    };
  }, [artifactId, workItemId, renderClass, enabled]);

  return {
    content,
    loading,
    error,
    retry,
    setContent: handleUpdate,
    renderClass,
    artifactType,
    hasCloudCopy,
  };
}
