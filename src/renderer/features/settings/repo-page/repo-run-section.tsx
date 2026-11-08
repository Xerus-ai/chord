import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { laneSetupChangedChannel } from '@shared/events/workItemEvents';
import type { AgentStartMode, ScriptKind } from '@shared/repo-config';
import type { RunMode } from '@shared/run-scripts';
import { SetupLog } from '@renderer/features/work-list/setup-log';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { SettingRow } from '../components/SettingRow';
import { LayerBadge, LayeredField } from './layered-field';
import { RunScriptsField } from './repo-run-scripts-field';
import { describeScriptLayer } from './script-layer-note';
import type { RepoSettingsData, useRepoSettings } from './use-repo-settings';

type Repo = ReturnType<typeof useRepoSettings>;

const SCRIPTS: Record<ScriptKind, { title: string; description: string }> = {
  setup: {
    title: 'Setup',
    description:
      "Runs in each new lane's checkout, after the files to copy. Agents wait for it unless Agent start says otherwise.",
  },
  test: {
    title: 'Test',
    description: "Runs the lane's tests when you press Test; its exit code is the result.",
  },
  teardown: {
    title: 'Teardown',
    description: "Runs in a lane's checkout when the lane is removed.",
  },
};

const RUN_MODE_OPTIONS: readonly { value: RunMode; label: string; help: React.ReactNode }[] = [
  {
    value: 'perWorktree',
    label: 'Per lane',
    help: 'Each lane runs its own copy in its checkout, on its own ports (CHORD_PORT).',
  },
  {
    value: 'solo',
    label: 'Solo',
    help: (
      <>
        One lane at a time runs in this repository's folder, so fixed ports and Docker Compose
        stacks are shared. A Compose run script should use{' '}
        <code className="font-mono">docker compose up --remove-orphans</code>.
      </>
    ),
  },
];

const AGENT_START_OPTIONS: readonly { value: AgentStartMode; label: string }[] = [
  { value: 'waitForSetup', label: 'Wait for setup' },
  { value: 'immediately', label: 'Start immediately' },
];

/**
 * Repo › Run & test: the scripts (a team script asks before it runs; your own
 * runs as is), whether agents wait for setup, and Run setup now per lane with
 * its live log.
 */
export function RepoRunSection({ data, repo }: { data: RepoSettingsData; repo: Repo }) {
  const { config } = data;
  if (!config) return null;
  const teamWritable = data.teamFile.writeBlocked === null;

  const scriptField = (kind: ScriptKind) => (
    <LayeredField
      title={SCRIPTS[kind].title}
      description={[
        SCRIPTS[kind].description,
        describeScriptLayer(config.scripts[kind].layer, 'single'),
      ]
        .filter((part) => part !== null)
        .join(' ')}
      value={config.scripts[kind].value}
      layer={config.scripts[kind].layer}
      emptyLabel="None"
      multiline
      onSaveJustMe={(value) => repo.saveJustMe({ scripts: { [kind]: value } })}
      onSaveTeam={
        teamWritable ? (value) => repo.saveTeam({ scripts: { [kind]: value } }) : undefined
      }
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {scriptField('setup')}
      <RunScriptsField
        run={config.scripts.run}
        onSaveJustMe={(value) => repo.saveJustMe({ scripts: { run: value } })}
        onSaveTeam={
          teamWritable ? (value) => repo.saveTeam({ scripts: { run: value } }) : undefined
        }
      />
      {scriptField('test')}
      {scriptField('teardown')}

      <RunModeRow data={data} repo={repo} />

      <SettingRow
        title={
          <span className="flex items-center gap-2">
            Agent start <LayerBadge layer={config.agentStart.layer} />
          </span>
        }
        description="Whether an agent's first turn waits until the lane's setup has finished."
        control={
          <SegmentedControl
            size="xs"
            options={AGENT_START_OPTIONS}
            value={config.agentStart.value}
            onChange={(value) =>
              void repo.saveJustMe({ agentStart: value === 'waitForSetup' ? null : value })
            }
          />
        }
      />

      <RunSetupNow repo={repo} />
    </div>
  );
}

/** Team-only: whether the codebase can run once per lane is the repository's property. */
function RunModeRow({ data, repo }: { data: RepoSettingsData; repo: Repo }) {
  const { config } = data;
  if (!config) return null;
  const blocked = data.teamFile.writeBlocked;
  const selected = RUN_MODE_OPTIONS.find((option) => option.value === config.runMode.value);
  if (!selected) throw new Error(`Unknown run mode ${config.runMode.value}`);

  return (
    <SettingRow
      title={
        <span className="flex items-center gap-2">
          Run mode <LayerBadge layer={config.runMode.layer} />
        </span>
      }
      description={
        blocked === null ? (
          selected.help
        ) : (
          <>
            {selected.help} Can't change it now: {blocked}
          </>
        )
      }
      control={
        <SegmentedControl
          size="xs"
          options={RUN_MODE_OPTIONS.map(({ value, label }) => ({
            value,
            label,
            ...(blocked === null ? {} : { disabledReason: blocked }),
          }))}
          value={config.runMode.value}
          onChange={(value) =>
            void repo.saveTeam({ runMode: value === 'perWorktree' ? null : value })
          }
        />
      }
    />
  );
}

function RunSetupNow({ repo }: { repo: Repo }) {
  const lanes = repo.lanes.data ?? [];
  const [running, setRunning] = useState<string | null>(null);
  const [shownLog, setShownLog] = useState<string | null>(null);
  const { refresh } = repo;

  // Setup status moves on its own (and in other windows): follow it.
  useEffect(
    () =>
      events.on(laneSetupChangedChannel, () => {
        void refresh();
      }),
    [refresh]
  );

  const runSetup = async (laneId: string) => {
    setRunning(laneId);
    setShownLog(laneId);
    try {
      // Setup asks for approval itself when the team's script is unapproved.
      const result = await rpc.worktrees.retrySetup(laneId);
      if (!result.success) {
        toast({
          title: 'Setup did not start',
          description: result.error.type,
          variant: 'destructive',
        });
      }
    } finally {
      setRunning(null);
      void refresh();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-body tracking-body text-text">Run setup now</span>
      {repo.lanes.error ? (
        <p className="text-tiny tracking-tiny text-status-err">{repo.lanes.error.message}</p>
      ) : lanes.length === 0 ? (
        <p className="text-tiny tracking-tiny text-text-passive">
          No lanes yet. Setup runs when a work item creates one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lanes.map((lane) => (
            <li key={lane.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border-subtle px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body tracking-body text-text">
                    {lane.workItemName}
                  </div>
                  <div className="truncate font-mono text-tiny tracking-tiny text-text-passive">
                    {lane.branchName ?? lane.path}
                  </div>
                </div>
                <span className="shrink-0 text-tiny tracking-tiny text-text-passive">
                  {lane.setupStatus ? `Setup ${lane.setupStatus}` : 'Setup not tracked'}
                </span>
                {lane.setupStatus && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setShownLog((open) => (open === lane.id ? null : lane.id))}
                  >
                    Log
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  disabled={running !== null || lane.setupStatus === 'running'}
                  onClick={() => void runSetup(lane.id)}
                >
                  {running === lane.id && <Loader2 className="h-3 w-3 animate-spin" />}
                  Run setup
                </Button>
              </div>
              {shownLog === lane.id && (
                <SetupLog worktreeId={lane.id} status={lane.setupStatus ?? 'pending'} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
