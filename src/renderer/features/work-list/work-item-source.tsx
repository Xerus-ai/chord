import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { createContext, useContext } from 'react';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import type { WorkItemCapabilities } from './work-item-access';

/**
 * Where the work item on screen comes from, and what its viewer can do
 * (shared-items step 4, decision 3). Owner and teammate render the same
 * components; a component whose data differs picks its local or cloud
 * container by `kind`, which never changes for a mounted view (the view is
 * keyed by the work item's id).
 */
interface WorkItemSourceBase {
  scope: 'work_item' | 'artifacts';
  workItemId: string;
  /** The centre layout's store key: tabs open into this view's own layout. */
  layoutKey: string;
  capabilities: WorkItemCapabilities;
}

export type WorkItemSource =
  | (WorkItemSourceBase & { kind: 'local' })
  /** A teammate's item, as the cloud serves it: its sessions, worktrees and policies. */
  | (WorkItemSourceBase & { kind: 'cloud'; item: CloudWorkItem })
  /**
   * An item reached only through artifacts shared alone: its header and those
   * artifacts. No work_item: route or room answers this viewer.
   */
  | (WorkItemSourceBase & { kind: 'scoped'; item: ArtifactsOnlyWorkItem });

const WorkItemSourceContext = createContext<WorkItemSource | null>(null);

export const WorkItemSourceProvider = WorkItemSourceContext.Provider;

export function useWorkItemSource(): WorkItemSource {
  const source = useContext(WorkItemSourceContext);
  if (!source) throw new Error('useWorkItemSource must be rendered inside WorkItemSourceProvider');
  return source;
}
