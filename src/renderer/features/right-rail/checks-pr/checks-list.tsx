import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { RowActions } from '@renderer/lib/components/list-row';
import { rpc } from '@renderer/lib/ipc';
import { statusTextClass, type StatusSignal } from '@renderer/lib/status-dot';
import { RailEmpty, RailSection } from '../rail-primitives';
import type { CheckEntry } from './pr-data';

const CHECK_SIGNAL: Record<CheckEntry['status'], StatusSignal> = {
  pass: 'success',
  fail: 'danger',
  pending: 'running',
};

function CheckGlyph({ status }: { status: CheckEntry['status'] }) {
  const tone = statusTextClass(CHECK_SIGNAL[status]);
  if (status === 'pass') return <CheckCircle2 className={`size-icon-sm shrink-0 ${tone}`} />;
  if (status === 'fail') return <XCircle className={`size-icon-sm shrink-0 ${tone}`} />;
  return <Loader2 className={`size-icon-sm shrink-0 animate-spin ${tone}`} />;
}

/**
 * One check. The row itself is inert — detail expands through the chevron at
 * its end, per the rail's row rule: a row click navigates or previews, it
 * never toggles its own detail.
 *
 * The detail is what the synced `pull_requests` rows carry: conclusion,
 * workflow, and the app that reported it. Chord stores no log tail, so the run
 * log is a link out rather than a pane that would sometimes be empty.
 */
function CheckRow({ check, onFixWithAi }: { check: CheckEntry; onFixWithAi: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col">
      <div className="group flex items-center gap-2 px-3 py-1.5 transition-[background] duration-[80ms] hover:bg-surface-hover">
        <CheckGlyph status={check.status} />
        <span className="min-w-0 flex-1 truncate text-list-row text-text" title={check.name}>
          {check.name}
        </span>
        {check.duration && (
          <span className="shrink-0 text-list-meta tabular-nums text-text-passive">
            {check.duration}
          </span>
        )}
        <RowActions>
          {check.status === 'fail' && (
            <button
              type="button"
              onClick={onFixWithAi}
              className="cursor-pointer rounded-xs border-none bg-transparent px-1.5 py-0.5 text-tiny tracking-tiny font-medium text-text-passive opacity-0 transition-[opacity,color] hover:text-text-muted group-hover:opacity-100"
            >
              Fix with AI
            </button>
          )}
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${check.name}`}
            onClick={() => setOpen((current) => !current)}
            className="flex cursor-pointer items-center justify-center rounded-xs border-none bg-transparent p-0.5 text-text-passive transition-colors hover:bg-surface-inset hover:text-text-muted"
          >
            {open ? (
              <ChevronDown className="size-icon-sm" />
            ) : (
              <ChevronRight className="size-icon-sm" />
            )}
          </button>
        </RowActions>
      </div>

      {open && (
        <dl className="flex flex-col gap-1 px-3 pb-2 pl-9 text-tiny tracking-tiny text-text-passive">
          <DetailLine label="Conclusion" value={check.conclusion ?? 'Not reported yet'} />
          {check.workflowName && <DetailLine label="Workflow" value={check.workflowName} />}
          {check.appName && <DetailLine label="Reported by" value={check.appName} />}
          {check.detailsUrl && (
            <button
              type="button"
              onClick={() => void rpc.app.openExternal(check.detailsUrl as string)}
              className="flex w-fit cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-tiny tracking-tiny text-text-muted hover:text-text"
            >
              Open run log
              <ExternalLink className="size-icon-xs" />
            </button>
          )}
        </dl>
      )}
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-text-passive">{label}</dt>
      <dd className="min-w-0 truncate">{value}</dd>
    </div>
  );
}

export function ChecksList({
  checks,
  onFixWithAi,
}: {
  checks: CheckEntry[];
  onFixWithAi: (checks: CheckEntry[]) => void;
}) {
  const failed = checks.filter((check) => check.status === 'fail');

  return (
    <RailSection sectionId="checks-pr:checks" title="Checks" count={checks.length}>
      {checks.length === 0 ? (
        <RailEmpty>No checks reported</RailEmpty>
      ) : (
        <>
          {failed.length > 0 && (
            <button
              type="button"
              onClick={() => onFixWithAi(failed)}
              className="mx-3 mb-1 cursor-pointer rounded-xs border border-border bg-transparent px-2 py-1 text-tiny tracking-tiny font-medium text-text-muted transition-colors hover:bg-surface-inset"
            >
              Fix {failed.length} failing check{failed.length === 1 ? '' : 's'} with AI
            </button>
          )}
          {checks.map((check) => (
            <CheckRow key={check.name} check={check} onFixWithAi={() => onFixWithAi([check])} />
          ))}
        </>
      )}
    </RailSection>
  );
}
