import { Button } from '@renderer/lib/ui/button';
import type { CreateTarget } from './create-target';
import type { BranchPreview } from './use-create-target';

const LINE = 'pt-1 text-tiny tracking-tiny';

function BranchLine({ branchPreview }: { branchPreview: BranchPreview | null }) {
  if (branchPreview?.status === 'ready') {
    return (
      <p className={`${LINE} font-mono text-text-muted`}>Branch: {branchPreview.branchName}</p>
    );
  }
  if (branchPreview?.status === 'failed') {
    return (
      <p className={`${LINE} text-status-err`}>
        The branch can&apos;t be named: {branchPreview.message}
      </p>
    );
  }
  return null;
}

/** The one way on from a branch checked out elsewhere: a new lane based on it. */
export function BranchOffButton({
  branch,
  onBranchOff,
}: {
  branch: string;
  onBranchOff: (branch: string) => void;
}) {
  return (
    <Button variant="outline" size="sm" onClick={() => onBranchOff(branch)}>
      Branch off {branch} instead
    </Button>
  );
}

/**
 * Under the Name field: what Create will make, before it is pressed — the
 * work item name a ticket gives, the branch, a PR's or branch's checkout, a
 * held branch's refusal, and the reason a lookup failed. Exactly what
 * `buildCreateWorkItemArgs` sends.
 */
export function CreateTargetPreview({
  target,
  branchPreview,
  onBranchOff,
}: {
  target: CreateTarget | null;
  branchPreview: BranchPreview | null;
  onBranchOff: (branch: string) => void;
}) {
  if (!target) return null;

  switch (target.kind) {
    case 'looking_up':
      return (
        <p role="status" className={`${LINE} text-text-passive`}>
          {target.label}
        </p>
      );
    case 'unavailable':
      return <p className={`${LINE} text-status-err`}>{target.message}</p>;
    case 'held':
      return (
        <div role="status" className="flex flex-col items-start gap-1.5">
          <p className={`${LINE} text-status-err`}>{target.message}</p>
          <BranchOffButton branch={target.branch} onBranchOff={onBranchOff} />
        </div>
      );
    case 'checkout':
      return (
        <div role="status">
          <p className={`${LINE} text-text-muted`}>{target.label}</p>
          {target.notice && <p className={`${LINE} text-status-warn`}>{target.notice}</p>}
        </div>
      );
    case 'branch_off':
      return (
        <div role="status">
          <p className={`${LINE} text-text-muted`}>{target.label}</p>
          <BranchLine branchPreview={branchPreview} />
        </div>
      );
    case 'new_lane':
      return (
        <div role="status">
          {target.ticket && <p className={`${LINE} text-text-muted`}>Work item: {target.name}</p>}
          <BranchLine branchPreview={branchPreview} />
          {target.notice && <p className={`${LINE} text-status-warn`}>{target.notice}</p>}
        </div>
      );
  }
}
