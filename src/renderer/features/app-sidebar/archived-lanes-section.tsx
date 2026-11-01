import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { ArchivedLanesGroup } from './archived-lanes-group';
import type { LaneRowHandlers } from './lane-row';

/**
 * The "Archived (n)" group of one work item, loaded from main
 * (`worktrees.listArchived`): whether each archived lane can be restored is
 * read from git, so it is fetched, not part of the sidebar summaries. Lane
 * actions invalidate it like the lane list.
 */
export function ArchivedLanesSection({
  workItemId,
  handlers,
}: {
  workItemId: string;
  handlers: LaneRowHandlers;
}) {
  const { data } = useQuery({
    queryKey: ['worktrees', 'archived', workItemId],
    queryFn: async () => {
      const result = await rpc.worktrees.listArchived(workItemId);
      if (!result.success) throw new Error(result.error.message);
      return result.data.lanes;
    },
  });
  const lanes = data ?? [];

  return (
    <ArchivedLanesGroup
      lanes={lanes}
      onRestore={(laneId) => handlers.restoreArchivedLane(workItemId, laneId)}
      onDelete={(laneId) => {
        const lane = lanes.find((candidate) => candidate.id === laneId);
        if (!lane) throw new Error(`Archived lane ${laneId} is not in the list it was picked from`);
        handlers.onDeleteArchivedLane(workItemId, lane);
      }}
    />
  );
}
