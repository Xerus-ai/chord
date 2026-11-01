/**
 * A filter that hides everything is not a first run. Telling someone with
 * plenty of work items to create one reads as data loss and hides the way out.
 */
export function EmptySidebar({ hasItems }: { hasItems: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-12 text-center">
      <p className="text-body tracking-body text-text-passive">
        {hasItems ? 'No work items match your filters' : 'No work items yet'}
      </p>
    </div>
  );
}
