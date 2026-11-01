import { useCallback, useEffect, useState } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { markdownToHtml } from './markdown';
import { reportViewWarnings } from './report-view-warnings';

export interface ArtifactVersion {
  id: string;
  label?: string | null;
  trigger: string;
  author_name?: string | null;
  created_at: string;
  version_number?: number;
  byte_size?: number;
  content?: string;
}

interface RawVersion {
  id: string;
  artifactId: string;
  versionNumber: number;
  authorName: string | null;
  label: string | null;
  content: string;
  byteSize: number;
  trigger: string;
  createdAt: number;
}

function toVersion(raw: RawVersion): ArtifactVersion {
  return {
    id: raw.id,
    label: raw.label,
    trigger: raw.trigger,
    author_name: raw.authorName,
    created_at: new Date(raw.createdAt * 1000).toISOString(),
    version_number: raw.versionNumber,
    byte_size: raw.byteSize,
    content: raw.content,
  };
}

interface UseVersionsOptions {
  workItemId: string;
  artifactId: string;
  enabled?: boolean;
  /**
   * Documents preview a snapshot through the editor, so its content is
   * converted to HTML. A page's snapshot is page source rendered in its own
   * sandbox frame (artifact-page-view.tsx) and is never converted.
   */
  previewAsDocument?: boolean;
}

export function useVersions({
  artifactId,
  enabled = true,
  previewAsDocument = true,
}: UseVersionsOptions) {
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<ArtifactVersion | null>(null);

  // A history read that failed must not render as "No version history yet" —
  // that told the user their saved snapshots were gone.
  const fetchVersions = useCallback(async () => {
    if (!artifactId) return;
    setLoading(true);
    setLoadError(null);
    try {
      // listVersions is Ok-only, so a failure arrives as a rejected IPC promise
      // rather than an err() branch — the catch below is the whole error path.
      const result = await rpc.artifacts.listVersions({ artifactId });
      setVersions((result.data.versions as RawVersion[]).map(toVersion));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[versions] listing versions failed:', e);
      setLoadError(`Version history could not be loaded: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => {
    if (enabled) void fetchVersions();
  }, [enabled, fetchVersions]);

  // Snapshots taken before the document became the source of truth hold raw
  // markdown copied off disk, so every snapshot goes through the same converter
  // the live document is seeded with. HTML snapshots pass through untouched.
  const previewVersionSnapshot = useCallback(
    (version: ArtifactVersion) => {
      setPreviewVersion(version);
      setPreviewHtml(previewAsDocument && version.content ? markdownToHtml(version.content) : null);
    },
    [previewAsDocument]
  );

  const clearPreview = useCallback(() => {
    setPreviewHtml(null);
    setPreviewVersion(null);
  }, []);

  // The live document is the source of truth, so a manual version snapshots the
  // document as it currently reads — not the file on disk, which lags behind
  // every edit made since the agent last wrote it.
  const saveManualVersion = useCallback(
    async (content: string, label?: string) => {
      if (!artifactId) return;

      // The author is stamped main-side from the signed-in account, so the
      // renderer never names the author of a stored row. The base is the
      // newest version this view has seen: one saved since is a conflict.
      const result = await rpc.artifacts.saveVersion({
        artifactId,
        content,
        trigger: 'manual',
        label,
        baseVersion: versions[0]?.version_number ?? 0,
      });

      if (!result.success && result.error.type === 'conflict') {
        toast({ title: 'Version not saved', description: result.error.message });
        await fetchVersions();
        return;
      }
      if (!result.success) {
        // A snapshot that was not stored must say so — the History tab would
        // otherwise look identical to a save that never happened.
        const description = `Saving version failed: ${result.error.message ?? result.error.type}`;
        console.error(`[versions] ${description}`);
        toast({ title: 'Saving version', description, variant: 'destructive' });
        return;
      }
      const saved = toVersion(result.data.version as RawVersion);
      setVersions((prev) => [saved, ...prev]);
      reportViewWarnings(`version ${saved.version_number}`, result.data.warnings);
    },
    [artifactId, versions, fetchVersions]
  );

  return {
    versions,
    loading,
    loadError,
    previewHtml,
    previewVersion,
    previewVersionSnapshot,
    clearPreview,
    saveManualVersion,
    refetch: fetchVersions,
  };
}
