import { Archive, GitPullRequest, Moon, SlidersHorizontal, SquareCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { TooltipProvider } from '@renderer/lib/ui/tooltip';
import {
  DrillBackRow,
  DrillChoiceRow,
  DrillRow,
  FilterRow,
  LABELS,
  SINGLE_CHOICE_SECTIONS,
  type DrillView,
} from './options-popover-section';
import {
  countActiveOptions,
  ROW_PROPERTY_KEYS,
  UNSUPPORTED_FILTERS,
  UNSUPPORTED_PROPERTIES,
  type FilterKey,
  type SidebarOptions,
  type UnsupportedReason,
} from './sidebar-options-model';

const FILTERS: { key: FilterKey; label: string; icon: React.ReactNode }[] = [
  {
    key: 'hideIdleOverSevenDays',
    label: 'Hide idle over 7 days',
    icon: <Moon className="size-icon-xs" strokeWidth={1.75} />,
  },
  {
    key: 'hideDone',
    label: 'Hide done',
    icon: <SquareCheck className="size-icon-xs" strokeWidth={1.75} />,
  },
  {
    key: 'hideTeammates',
    label: "Hide teammates' items",
    icon: <Users className="size-icon-xs" strokeWidth={1.75} />,
  },
  {
    key: 'hideWithoutPullRequest',
    label: 'Hide items without a PR',
    icon: <GitPullRequest className="size-icon-xs" strokeWidth={1.75} />,
  },
  {
    key: 'hideArchivedWorktrees',
    label: 'Hide archived worktrees',
    icon: <Archive className="size-icon-xs" strokeWidth={1.75} />,
  },
];

/** The root view's content: `Show` (repositories), the drill-in rows, and the
 * filter switches, in a compact shape: everything a row rather than a
 * section of its own segmented control. */
function RootView({
  options,
  repos,
  onChange,
  onDrillInto,
}: {
  options: SidebarOptions;
  repos: readonly { id: string; label: string }[];
  onChange: (next: SidebarOptions) => void;
  onDrillInto: (view: DrillView) => void;
}) {
  const enabledPropertyCount = ROW_PROPERTY_KEYS.filter((key) => options.properties[key]).length;
  const repoValue =
    options.visibleRepoIds.length === 0 ? 'All' : `${options.visibleRepoIds.length} selected`;

  return (
    <>
      <p className="px-2 pb-1 pt-2 text-body tracking-body font-semibold text-text">
        Display options
      </p>

      <p className="px-2 pb-1 pt-2 text-micro tracking-micro font-medium uppercase text-text-passive">
        Show
      </p>
      <DrillRow
        label="Repositories"
        value={repos.length === 0 ? 'None yet' : repoValue}
        onClick={() => onDrillInto('repos')}
      />

      <div className="my-1.5 h-px bg-border" />

      {(Object.keys(SINGLE_CHOICE_SECTIONS) as (keyof typeof SINGLE_CHOICE_SECTIONS)[]).map(
        (key) => {
          const section = SINGLE_CHOICE_SECTIONS[key];
          return (
            <DrillRow
              key={key}
              label={section.label}
              value={(section.labels as Record<string, string>)[options[key]]}
              onClick={() => onDrillInto(key)}
            />
          );
        }
      )}
      <DrillRow
        label="Show properties"
        value={String(enabledPropertyCount)}
        onClick={() => onDrillInto('properties')}
      />

      <div className="my-1.5 h-px bg-border" />

      <p className="px-2 pb-1 text-micro tracking-micro font-medium uppercase text-text-passive">
        Filters
      </p>
      {FILTERS.map(({ key, label, icon }) => (
        <FilterRow
          key={key}
          icon={icon}
          label={label}
          checked={options.filters[key]}
          unsupportedReason={UNSUPPORTED_FILTERS[key]}
          onCheckedChange={(next) =>
            onChange({ ...options, filters: { ...options.filters, [key]: next } })
          }
        />
      ))}
    </>
  );
}

/** A drill-in view: a back row, then the section's choices — replacing the
 * root's content inside the same popover rather than nesting a popover. */
function DrillInView({
  view,
  options,
  repos,
  onChange,
  onBack,
}: {
  view: Exclude<DrillView, 'root'>;
  options: SidebarOptions;
  repos: readonly { id: string; label: string }[];
  onChange: (next: SidebarOptions) => void;
  onBack: () => void;
}) {
  if (view === 'repos') {
    const toggleRepo = (repoId: string) => {
      const visible = options.visibleRepoIds;
      onChange({
        ...options,
        visibleRepoIds: visible.includes(repoId)
          ? visible.filter((id) => id !== repoId)
          : [...visible, repoId],
      });
    };
    return (
      <>
        <DrillBackRow label="Repositories" onBack={onBack} />
        {repos.map((repo) => (
          <DrillChoiceRow
            key={repo.id}
            label={repo.label}
            multi
            selected={
              options.visibleRepoIds.length === 0 || options.visibleRepoIds.includes(repo.id)
            }
            onSelect={() => toggleRepo(repo.id)}
          />
        ))}
      </>
    );
  }

  if (view === 'properties') {
    return (
      <>
        <DrillBackRow label="Show properties" onBack={onBack} />
        {ROW_PROPERTY_KEYS.map((key) => (
          <DrillChoiceRow
            key={key}
            label={LABELS.properties[key]}
            multi
            selected={options.properties[key]}
            unsupportedReason={UNSUPPORTED_PROPERTIES[key]}
            onSelect={() =>
              onChange({
                ...options,
                properties: { ...options.properties, [key]: !options.properties[key] },
              })
            }
          />
        ))}
      </>
    );
  }

  const section = SINGLE_CHOICE_SECTIONS[view];
  return (
    <>
      <DrillBackRow label={section.label} onBack={onBack} />
      {section.values.map((value) => (
        <DrillChoiceRow
          key={value}
          label={(section.labels as Record<string, string>)[value]}
          multi={false}
          selected={options[view] === value}
          unsupportedReason={
            (section.unsupported as Partial<Record<string, UnsupportedReason>>)[value]
          }
          onSelect={() => {
            onChange({ ...options, [view]: value });
            onBack();
          }}
        />
      ))}
    </>
  );
}

export function SidebarOptionsPopover({
  options,
  repos,
  onChange,
}: {
  options: SidebarOptions;
  repos: readonly { id: string; label: string }[];
  onChange: (next: SidebarOptions) => void;
}) {
  const activeCount = countActiveOptions(options);
  const [view, setView] = useState<DrillView>('root');

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setView('root');
      }}
    >
      <PopoverTrigger
        aria-label="Sidebar options"
        className="relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
      >
        <SlidersHorizontal className="size-icon-sm" strokeWidth={2.25} />
        {activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-action-bg px-1 text-micro tracking-micro tabular-nums text-action-fg">
            {activeCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[300px] gap-0 p-1.5"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || view === 'root') return;
          event.preventDefault();
          event.stopPropagation();
          setView('root');
        }}
      >
        <TooltipProvider delay={200}>
          {view === 'root' ? (
            <RootView options={options} repos={repos} onChange={onChange} onDrillInto={setView} />
          ) : (
            <DrillInView
              view={view}
              options={options}
              repos={repos}
              onChange={onChange}
              onBack={() => setView('root')}
            />
          )}
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
