import { CheckCircle, Circle } from 'lucide-react';
import type { PlanEntryData } from './chat-types';

interface PlanProgressProps {
  entries: PlanEntryData[];
  completedCount: number;
  totalCount: number;
}

export function PlanProgress({ entries, completedCount, totalCount }: PlanProgressProps) {
  const allDone = completedCount === totalCount;

  return (
    <div className="mt-2 rounded-[var(--radius-sm)] bg-surface-raised px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-tiny tracking-tiny">
        {allDone ? (
          <CheckCircle className="h-[14px] w-[14px] text-status-ok" />
        ) : (
          <Circle className="h-[14px] w-[14px] text-text-passive" />
        )}
        <span className={allDone ? 'font-medium text-status-ok' : 'text-text-muted'}>
          {completedCount} of {totalCount} completed
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5 text-tiny tracking-tiny">
            {entry.completed ? (
              <CheckCircle className="h-3 w-3 shrink-0 text-status-ok" />
            ) : (
              <Circle className="h-3 w-3 shrink-0 text-text-passive" />
            )}
            <span className={entry.completed ? 'text-text-muted line-through' : 'text-text'}>
              {entry.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
