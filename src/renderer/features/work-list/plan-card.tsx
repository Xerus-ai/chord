import { Check, ChevronRight, Diamond, PencilLine, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import { APPROVAL_NOTICE, type ApprovalAnswer } from './approval-answer';

interface PlanCardProps {
  /** The plan's artifact; a teammate's request from the cloud has none. */
  artifactId?: string;
  title: string;
  overview: string;
  steps: Array<{ text: string; completed: boolean }>;
  /**
   * `adjusted` = the user sent feedback instead of approving; the agent
   * revises and presents a new plan card.
   * `expired` = the plan was never answered and no longer can be (the session
   * that asked is gone). It renders read-only: live Approve/Reject buttons on
   * a plan nothing is waiting for are worse than no buttons.
   */
  status: 'pending' | 'approved' | 'rejected' | 'adjusted' | 'expired';
  rationale?: string;
  /** Raw plan markdown from the agent — rendered as the document body when present. */
  planMarkdown?: string;
  /** Whether this viewer can answer a pending plan now; the owner always can. */
  answer?: ApprovalAnswer;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  /** Feedback instead of an answer. Absent for a teammate: their command carries approve or reject only. */
  onAdjust?: (feedback: string) => Promise<void>;
  /** Opens the plan's artifact; given with `artifactId`. */
  onOpenArtifact?: (artifactId: string, title: string) => void;
}

function PlanStepBadge({ index }: { index: number }) {
  return (
    <span className="mt-[2px] flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-hover-solid font-mono text-tiny tracking-tiny font-normal tabular-nums text-text-passive">
      {index}
    </span>
  );
}

/**
 * The plan document itself. The agent's markdown IS the plan — rendering it
 * verbatim instead of a lossy parsed checklist keeps
 * context, code blocks, and rationale intact. The parsed steps remain the
 * fallback for transports that only deliver structured entries.
 */
function PlanBody({
  planMarkdown,
  overview,
  steps,
  rationale,
}: Pick<PlanCardProps, 'planMarkdown' | 'overview' | 'steps' | 'rationale'>) {
  if (planMarkdown) {
    return (
      <div className="flex flex-col gap-3 bg-surface px-5 pt-4 pb-4">
        <MarkdownRenderer
          content={planMarkdown}
          variant="full"
          className="text-body tracking-body leading-[1.65] text-text-muted"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 bg-surface px-5 pt-5 pb-4">
      <p className="max-w-[65ch] text-body tracking-body leading-[1.65] text-text-muted">
        {overview}
      </p>

      <div className="my-1 h-px bg-border" />

      <h4 className="text-title tracking-title font-medium italic text-text">
        Implementation Steps
      </h4>

      <ol className="flex list-none flex-col gap-2 p-0">
        {steps.map((step, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-body tracking-body leading-[1.6] text-text-muted"
          >
            <PlanStepBadge index={i + 1} />
            <span>{step.text}</span>
          </li>
        ))}
      </ol>

      {rationale && (
        <>
          <div className="my-1 h-px bg-border" />
          <p className="max-w-[65ch] border-l-2 border-border pl-4 text-body tracking-body italic leading-[1.6] text-text-passive">
            {rationale}
          </p>
        </>
      )}
    </div>
  );
}

function PendingPlanCard({
  title,
  overview,
  steps,
  rationale,
  planMarkdown,
  answer = 'answer',
  onApprove,
  onReject,
  onAdjust,
}: Omit<PlanCardProps, 'artifactId' | 'status' | 'onOpenArtifact'>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [adjustText, setAdjustText] = useState('');
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function respond(send: () => Promise<void>, onFailure?: () => void) {
    if (responding) return;
    setResponding(true);
    setError(null);
    send().catch((e: unknown) => {
      setResponding(false);
      setError(e instanceof Error ? e.message : String(e));
      onFailure?.();
    });
  }

  function handleAdjustSubmit() {
    const text = adjustText.trim();
    if (!text || responding || !onAdjust) return;
    setAdjustText('');
    // An undelivered adjustment goes back in the box — it was never sent, so
    // the user should not have to retype it.
    respond(
      () => onAdjust(text),
      () => setAdjustText(text)
    );
  }

  // The approval bar advertises ⌘⏎. It fires from anywhere inside the card,
  // which in practice means the adjustment input the hint sits above — plain
  // Enter there sends the adjustment, ⌘⏎ approves the plan as written.
  function handleCardKeyDown(e: React.KeyboardEvent) {
    if (answer !== 'answer' || e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    respond(onApprove);
  }

  return (
    <div
      onKeyDown={handleCardKeyDown}
      className="mt-2 max-w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-border"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-5 py-3">
        <Diamond className="h-4 w-4 shrink-0 text-text" />
        <span className="flex-1 text-body tracking-body font-medium text-text">{title}</span>
        <span className="rounded-[var(--radius-sm)] bg-surface-active px-2 py-[2px] text-micro tracking-micro font-medium uppercase text-text">
          Review Plan
        </span>
      </div>

      <PlanBody
        planMarkdown={planMarkdown}
        overview={overview}
        steps={steps}
        rationale={rationale}
      />

      {error && (
        <div className="border-t border-border px-5 py-2 text-tiny tracking-tiny text-status-err">
          Could not send your response: {error}
        </div>
      )}

      {answer !== 'answer' && (
        <div className="border-t border-border bg-surface-raised px-5 py-3 text-body tracking-body text-text-passive">
          {APPROVAL_NOTICE[answer]}
        </div>
      )}

      {/* Approval bar */}
      {answer === 'answer' && (
        <div className="flex items-center gap-3 border-t border-border bg-surface-raised px-5 py-3">
          <span className="flex-1 text-tiny tracking-tiny text-text-passive">
            Approve the plan{' '}
            <kbd className="rounded-[var(--radius-sm)] border border-border-strong bg-surface-hover-solid px-1 py-px font-mono text-micro tracking-micro font-normal text-text-muted">
              ⌘⏎
            </kbd>{' '}
            {onAdjust ? 'or tell the AI what to do differently' : 'or reject it'}
          </span>
          <button
            onClick={() => respond(onReject)}
            disabled={responding}
            className="cursor-pointer rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-1 text-body tracking-body font-medium text-text-passive transition-colors duration-100 ease-out hover:bg-surface-hover-solid hover:text-text-muted disabled:cursor-not-allowed disabled:text-text-disabled"
          >
            Reject
          </button>
          <button
            onClick={() => respond(onApprove)}
            disabled={responding}
            /* Monochrome, not the plan accent: the accent marks what the agent
             produced, and a button is what the user does about it. */
            className="cursor-pointer rounded-[var(--radius-md)] border-none bg-action-bg px-3 py-1 text-body tracking-body font-normal text-action-fg transition-colors duration-100 ease-out hover:bg-action-bg-hover disabled:cursor-not-allowed disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
          >
            Approve{' '}
            <kbd className="font-mono text-micro tracking-micro font-normal opacity-60">⌘⏎</kbd>
          </button>
        </div>
      )}

      {/* Adjustment input */}
      {answer === 'answer' && onAdjust && (
        <div className="border-t border-dashed border-border bg-surface-raised px-5 py-2">
          <input
            ref={inputRef}
            type="text"
            value={adjustText}
            onChange={(e) => setAdjustText(e.target.value)}
            onKeyDown={(e) => {
              // ⌘⏎/Ctrl+⏎ belongs to the card's approve binding — handling it
              // here too would send the adjustment and approve on one press.
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                handleAdjustSubmit();
              }
              if (e.key === 'Escape') {
                inputRef.current?.blur();
              }
            }}
            placeholder="Enter your plan adjustments here..."
            className="w-full border-none bg-transparent py-1 text-body tracking-body text-text-muted outline-none placeholder:text-text-passive"
          />
        </div>
      )}
    </div>
  );
}

function ApprovedPlanCard({
  title,
  steps,
  overview,
  planMarkdown,
  onOpenArtifact,
  artifactId,
}: Pick<
  PlanCardProps,
  'title' | 'steps' | 'overview' | 'planMarkdown' | 'onOpenArtifact' | 'artifactId'
>) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 max-w-[720px]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border border-status-ok/15 bg-status-ok-bg px-4 py-2 transition-colors duration-100 ease-out hover:bg-status-ok-bg/[0.18]"
      >
        <Check className="h-4 w-4 shrink-0 text-status-ok" strokeWidth={2.5} />
        <span className="flex-1 text-left text-body tracking-body font-medium text-status-ok">
          Plan approved — {title}
        </span>
        <span className="text-tiny tracking-tiny tabular-nums text-text-passive">
          {steps.length} steps
        </span>
        <ChevronRight
          className={`h-3.5 w-3.5 text-text-passive transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div className="mt-[2px] overflow-hidden rounded-[var(--radius-lg)] border border-border">
          <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-5 py-3">
            <Diamond className="h-4 w-4 shrink-0 text-text" />
            <span className="flex-1 text-body tracking-body font-medium text-text">{title}</span>
            <span className="rounded-[var(--radius-sm)] bg-status-ok-bg px-2 py-[2px] text-micro tracking-micro font-medium uppercase text-status-ok">
              Approved
            </span>
          </div>
          <PlanBody planMarkdown={planMarkdown} overview={overview} steps={steps} />
          {artifactId && onOpenArtifact && (
            <div className="flex items-center border-t border-border bg-surface-raised px-5 py-2">
              <button
                onClick={() => onOpenArtifact(artifactId, title)}
                className="cursor-pointer rounded-[var(--radius-md)] bg-action-bg px-3 py-1 text-micro tracking-micro font-normal text-action-fg transition-colors duration-100 ease-out hover:bg-action-bg-hover"
              >
                Open plan
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdjustedPlanCard({ title }: Pick<PlanCardProps, 'title'>) {
  return (
    <div className="mt-2 flex max-w-[720px] items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface-raised px-4 py-2">
      <PencilLine className="h-4 w-4 shrink-0 text-text" strokeWidth={2.5} />
      <span className="flex-1 text-body tracking-body font-medium text-text-muted">
        Adjustments requested — {title}
      </span>
      <span className="text-tiny tracking-tiny text-text-passive">
        The agent is revising the plan
      </span>
    </div>
  );
}

function RejectedPlanCard({ title }: Pick<PlanCardProps, 'title'>) {
  return (
    <div className="mt-2 flex max-w-[var(--max-content-width)] items-center gap-3 rounded-[var(--radius-md)] border border-border px-4 py-2">
      <X className="size-icon-md shrink-0 text-status-err" />
      <span className="flex-1 text-body tracking-body font-normal text-status-err">
        Plan rejected — {title}
      </span>
    </div>
  );
}

function ExpiredPlanCard({
  title,
  steps,
  overview,
  planMarkdown,
  onOpenArtifact,
  artifactId,
}: Pick<
  PlanCardProps,
  'title' | 'steps' | 'overview' | 'planMarkdown' | 'onOpenArtifact' | 'artifactId'
>) {
  return (
    <div className="mt-2 max-w-[720px] overflow-hidden rounded-[var(--radius-lg)] border border-border opacity-80">
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-5 py-3">
        <Diamond className="h-4 w-4 shrink-0 text-text-passive" />
        <span className="flex-1 text-body tracking-body font-medium text-text-muted">{title}</span>
        <span className="rounded-[var(--radius-sm)] bg-surface-hover-solid px-2 py-[2px] text-micro tracking-micro font-medium uppercase text-text-passive">
          Expired
        </span>
      </div>
      <p className="bg-surface px-5 pt-4 text-tiny tracking-tiny text-text-passive">
        This plan was never answered and the session that asked for it has ended, so it can no
        longer be approved or rejected.
      </p>
      <PlanBody planMarkdown={planMarkdown} overview={overview} steps={steps} />
      {artifactId && onOpenArtifact && (
        <div className="flex items-center border-t border-border bg-surface-raised px-5 py-2">
          <button
            onClick={() => onOpenArtifact(artifactId, title)}
            className="cursor-pointer rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-1 text-micro tracking-micro font-normal text-text-muted transition-colors duration-100 ease-out hover:bg-surface-hover-solid"
          >
            Open plan
          </button>
        </div>
      )}
    </div>
  );
}

export function PlanCard(props: PlanCardProps) {
  switch (props.status) {
    case 'pending':
      return <PendingPlanCard {...props} />;
    case 'approved':
      return <ApprovedPlanCard {...props} />;
    case 'adjusted':
      return <AdjustedPlanCard {...props} />;
    case 'rejected':
      return <RejectedPlanCard {...props} />;
    case 'expired':
      return <ExpiredPlanCard {...props} />;
  }
}
