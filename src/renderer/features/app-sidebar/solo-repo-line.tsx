import { useSoloView } from '@renderer/features/right-rail/run/use-solo';
import { toastRpcFailure } from '@renderer/features/work-list/describe-action-failure';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { SoloHeaderLine } from './solo-header-line';
import { describeSoloHeader } from './solo-header-model';

/**
 * A local repository's Solo line under its sidebar header. Restore releases
 * the interrupted Solo; when the root changed since — which is why it was
 * interrupted — the files are listed and discarding them is a confirm of its
 * own, never implied.
 */
export function SoloRepoLine({
  repoId,
  onOpenWorkItem,
}: {
  repoId: string;
  onOpenWorkItem: (workItemId: string) => void;
}) {
  const solo = useSoloView(repoId);
  const showConfirm = useShowModal('confirmActionModal');
  const model = describeSoloHeader(solo.data);
  if (!model) return null;

  const release = async (discardRootChanges: boolean) => {
    const result = await rpc.solo.release({ repoId, discardRootChanges });
    if (result.success) return;
    if (result.error.type !== 'root_changed') {
      toastRpcFailure('Restore Solo', result.error);
      return;
    }
    showConfirm({
      title: 'Discard the root’s changes and release?',
      description:
        `These changed in ${solo.data?.rootPath} during Solo: ${result.error.files.join(', ')}. ` +
        'Releasing puts the root back on its branch and drops them.',
      confirmLabel: 'Discard and release',
      variant: 'destructive',
      onSuccess: () => void restore(true),
    });
  };
  const restore = (discardRootChanges: boolean) =>
    release(discardRootChanges).catch((error: unknown) =>
      toastRpcFailure('Restore Solo', error instanceof Error ? error.message : String(error))
    );

  return (
    <SoloHeaderLine
      model={model}
      onFocusWorkItem={onOpenWorkItem}
      onRestore={() => void restore(false)}
    />
  );
}
