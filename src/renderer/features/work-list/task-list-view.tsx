import { Check, Circle, ListTodo } from 'lucide-react';
import type { TaskListEntry } from '@shared/stream-items';

interface TaskListViewProps {
  title: string;
  entries: TaskListEntry[];
  completedCount: number;
  totalCount: number;
}

export function TaskListView({ title, entries, completedCount, totalCount }: TaskListViewProps) {
  return (
    <div className="tool-group mt-2 overflow-hidden rounded-[var(--radius-sm)]">
      <div className="flex items-center gap-2 px-3 py-2 text-tiny tracking-tiny">
        <ListTodo className="h-3.5 w-3.5 shrink-0 text-text-passive" />
        <span className="font-medium text-text-muted">{title}</span>
        <span className="text-text-passive">
          {completedCount} of {totalCount}
        </span>
        {completedCount === totalCount && totalCount > 0 && (
          <Check className="h-3 w-3 shrink-0 text-status-ok/60" />
        )}
      </div>
      <div className="tool-group-body px-3 py-1.5">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-start gap-2 py-1 text-tiny tracking-tiny">
            {entry.completed ? (
              <Check className="mt-[2px] h-3.5 w-3.5 shrink-0 text-status-ok" />
            ) : (
              <Circle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-text-passive/40" />
            )}
            <span
              className={entry.completed ? 'text-text-passive line-through' : 'text-text-muted'}
            >
              {entry.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
