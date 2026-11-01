import { useState } from 'react';
import type { LaneSetupStatus } from '@shared/events/workItemEvents';
import type { LaneRunView } from '@shared/lane-runs';
import { SetupLog } from '@renderer/features/work-list/setup-log';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { useResolvedRailScope } from '../rail-context';
import { PanelShell, RailEmpty, RailError, RailSection } from '../rail-primitives';
import { RunEmptyState } from './run-empty-state';
import { formatPortBlock, isRunTabEmpty } from './run-model';
import { RunScriptRow } from './run-script-row';
import { RunTerminal } from './run-terminal';
import { RunTestRow } from './run-test-row';
import { SoloRunScripts } from './solo-run-scripts';
import { useLaneRunActions, useLaneRunView } from './use-lane-runs';
import { useSoloView } from './use-solo';

/**
 * The Run tab (plan §Phase 4): the focused lane's setup, its run scripts,
 * its test and its port block — the processes of this machine's checkout,
 * so the owner's only.
 */
export function RunPanel() {
  const scope = useResolvedRailScope();
  const view = useLaneRunView(scope?.worktreeId ?? null);

  return (
    <PanelShell title="Run">
      {!scope ? (
        <RailEmpty>No checkout yet</RailEmpty>
      ) : view.error ? (
        <RailError message={view.error.message} />
      ) : !view.data ? (
        <RailEmpty>Loading…</RailEmpty>
      ) : (
        <RunPanelBody view={view.data} />
      )}
    </PanelShell>
  );
}

function RunPanelBody({ view }: { view: LaneRunView }) {
  const { navigate } = useNavigate();
  const actions = useLaneRunActions(view.laneId);
  const { repoId } = view;
  const soloRepoId = view.runMode === 'solo' ? repoId : null;
  const solo = useSoloView(soloRepoId);
  // While this lane holds Solo its test runs in the root, beside its stack.
  const testInRoot = solo.data?.holder?.laneId === view.laneId;
  const openRunSettings = repoId
    ? () =>
        navigate('settings', {
          tab: 'repository',
          card: undefined,
          repoId,
          repoSection: 'run',
        })
    : undefined;

  return (
    <>
      {view.configError && <RailError message={view.configError} />}
      <SetupSection laneId={view.laneId} status={view.setupStatus} />
      {isRunTabEmpty(view) ? (
        !view.configError && <RunEmptyState onSetUp={openRunSettings} />
      ) : (
        <>
          {soloRepoId !== null ? (
            solo.error ? (
              <RailError message={solo.error.message} />
            ) : solo.data ? (
              <SoloRunScripts view={view} repoId={soloRepoId} solo={solo.data} actions={actions} />
            ) : (
              <RailEmpty>Loading…</RailEmpty>
            )
          ) : (
            <RailSection sectionId="run-scripts" title="Run scripts" count={view.scripts.length}>
              {view.scripts.map((script) => {
                const state = view.runs.scripts[script.id];
                const key = `run:${script.id}`;
                return (
                  <RunScriptRow
                    key={script.id}
                    title={script.title}
                    state={state}
                    error={actions.errors[key] ?? null}
                    pending={actions.pending.has(key)}
                    onStart={() => void actions.start(script.id)}
                    onStop={() => void actions.stop(script.id)}
                    onRestart={() => void actions.restart(script.id)}
                    onOpenUrl={(url) => void rpc.app.openExternal(url)}
                    // A new run is a new process: its terminal starts clean.
                    renderTerminal={(id) => (
                      <RunTerminal key={state?.startedAt} ptySessionId={id} />
                    )}
                  />
                );
              })}
              <p className="px-3 pt-1 font-mono text-list-meta text-text-passive">
                {formatPortBlock(view.ports)}
              </p>
            </RailSection>
          )}
          {view.hasTest && (
            <RailSection sectionId="run-test" title="Test">
              <RunTestRow
                test={view.runs.test}
                error={actions.errors.test ?? null}
                pending={actions.pending.has('test')}
                onRun={() => void (testInRoot ? actions.runTestInRoot() : actions.runTest())}
                onStop={() => void actions.stopTest()}
              />
            </RailSection>
          )}
        </>
      )}
    </>
  );
}

const SETUP_LABEL: Record<LaneSetupStatus, string> = {
  pending: 'Waiting to start',
  running: 'Running…',
  ok: 'Done',
  failed: 'Failed',
  skipped: "Skipped — you chose Don't run",
};

/** The lane's setup: its state, its log, and Run setup (which asks about an unapproved script). */
function SetupSection({ laneId, status }: { laneId: string; status: LaneSetupStatus | null }) {
  const [running, setRunning] = useState(false);
  const runSetup = async () => {
    setRunning(true);
    try {
      const result = await rpc.worktrees.retrySetup(laneId);
      if (!result.success) {
        toast({
          title: 'Setup did not start',
          description: result.error.type,
          variant: 'destructive',
        });
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <RailSection sectionId="run-setup" title="Setup" defaultOpen={status !== 'ok'}>
      <div className="flex flex-col gap-1.5 px-3 py-1">
        <div className="flex items-center gap-2">
          <span className="flex-1 text-list-row text-text">
            {status ? SETUP_LABEL[status] : 'Not tracked for this lane'}
          </span>
          <Button
            variant="outline"
            size="xs"
            disabled={running || status === 'running' || status === 'pending'}
            onClick={() => void runSetup()}
          >
            Run setup
          </Button>
        </div>
        {status && <SetupLog worktreeId={laneId} status={status} />}
      </div>
    </RailSection>
  );
}
