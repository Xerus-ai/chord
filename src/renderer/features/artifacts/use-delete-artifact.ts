import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { sharingApi, type SharingState } from '@renderer/features/sharing/sharing-api';
import { artifactPathTab } from '@renderer/features/work-list/center-tab';
import { closeCenterTab } from '@renderer/features/work-list/center-tabs-store';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

/** Anyone besides the author can open it: its own members/access, or its work item's. */
function isSharedWithOthers(state: SharingState): boolean {
  if (state.members.length > 0 || state.general_access !== 'invited') return true;
  const item = state.work_item;
  return !!item && (item.members.length > 0 || item.general_access !== 'invited');
}

/**
 * The artifact Delete action (P6). Deleting removes the artifact for everyone
 * — the cloud refuses anyone but the author — while the file stays in the
 * repository. With Agents › Artifacts › "Ask before deleting a shared
 * artifact" on, a shared artifact asks first and says what breaks.
 */
export function useDeleteArtifact(args: { workItemId: string; artifactId: string; title: string }) {
  const { workItemId, artifactId, title } = args;
  const queryClient = useQueryClient();
  const showConfirm = useShowModal('confirmActionModal');
  const { value: artifactSettings } = useAppSettingsKey('artifacts');
  const [deleting, setDeleting] = useState(false);

  const performDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const result = await rpc.artifacts.delete({ id: artifactId });
      if (!result.success) throw new Error(result.error.message);
      closeCenterTab(workItemId, artifactPathTab(artifactId, title));
      await queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      await queryClient.invalidateQueries({ queryKey: ['sharing'] });
    } catch (e) {
      toast({
        title: 'Could not delete artifact',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }, [artifactId, workItemId, title, queryClient]);

  const requestDelete = useCallback(async () => {
    let shared: boolean;
    try {
      shared = isSharedWithOthers(await sharingApi.getSharing({ workItemId, artifactId }));
    } catch (e) {
      // Never synced to the cloud: nobody else can have it.
      if (!(e instanceof CloudApiError && e.status === 404)) throw e;
      shared = false;
    }

    if (!shared || artifactSettings?.confirmDeleteShared === false) {
      await performDelete();
      return;
    }

    const page = await rpc.artifacts.hasConfluencePage({ id: artifactId });
    const confluence = page.data.published
      ? ' The Confluence page stays — remove it in Confluence if it should go too.'
      : '';
    showConfirm({
      title: `Delete "${title}"?`,
      description: `It's deleted for everyone it's shared with, and its link stops working. Comments and versions go with it. The file stays in your repository.${confluence}`,
      confirmLabel: 'Delete',
      variant: 'destructive',
      onSuccess: () => void performDelete(),
    });
  }, [
    workItemId,
    artifactId,
    title,
    artifactSettings?.confirmDeleteShared,
    performDelete,
    showConfirm,
  ]);

  return { requestDelete, deleting };
}
