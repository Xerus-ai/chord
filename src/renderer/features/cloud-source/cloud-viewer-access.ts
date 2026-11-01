import type { WorkItemAccessInput } from '@renderer/features/work-list/work-item-access';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';

/**
 * Who a viewer of a cloud work item is. The cloud view has no checkout, so
 * even the item's author (reading it on another machine) is a member here,
 * with edit. `caller_role` comes with the per-id GET the view resolves from;
 * `liveRole`, from participant_role_changed, overrides it the moment the
 * owner changes this viewer's role.
 */
export function cloudViewerAccess(
  item: Pick<CloudWorkItem, 'id' | 'caller_role' | 'approval_policy'>,
  liveRole: string | null
): WorkItemAccessInput {
  if (item.caller_role === undefined) {
    throw new Error(`Work item ${item.id} was read without the caller's role`);
  }
  const role = liveRole ?? item.caller_role;
  return {
    viewer: 'member',
    role: role === 'view' ? 'view' : 'edit',
    scope: 'work_item',
    approvalPolicy: item.approval_policy === 'participants' ? 'participants' : 'owner',
    author: item.caller_role === 'author',
  };
}
