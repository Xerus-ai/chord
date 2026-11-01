/**
 * What Delete asks before removing a work item. A work item on an adopted
 * checkout (plan §Phase 3 slice 6) loses its rows, sessions and checkpoints
 * like any other, but its folder is the user's: the confirm says it stays.
 */
export function describeWorkItemDeleteConfirm(args: {
  name: string;
  adopted: { path: string; branch: string | null } | null;
}): { title: string; description: string } {
  const removed =
    'This removes the work item, its sessions, and its checkpoints from this machine, and deletes it for anyone it is shared with.';
  const kept = args.adopted
    ? `The folder ${args.adopted.path}, its files${args.adopted.branch ? ` and the branch ${args.adopted.branch}` : ''} stay as they are: the checkout is yours.`
    : 'The git branch and its commits stay in the repository.';
  return { title: `Delete "${args.name}"?`, description: `${removed} ${kept}` };
}
