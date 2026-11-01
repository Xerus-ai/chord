import { Button } from '@renderer/lib/ui/button';

/**
 * The repository declares no run or test script: say so, and where to add
 * them — absent only for a work item with no repository to configure.
 */
export function RunEmptyState({ onSetUp }: { onSetUp?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-3 py-6 text-center">
      <p className="text-tiny tracking-tiny text-text-passive">
        This repository has no run or test script.
      </p>
      {onSetUp && (
        <Button variant="outline" size="xs" onClick={onSetUp}>
          Set up Run &amp; test
        </Button>
      )}
    </div>
  );
}
