import type { LaneRunView } from '@shared/lane-runs';
import type { SoloView } from '@shared/solo';
import { rpc } from '@renderer/lib/ipc';
import { RailSection } from '../rail-primitives';
import { formatPortBlock } from './run-model';
import { RunScriptRow } from './run-script-row';
import { RunTerminal } from './run-terminal';
import { SoloControls } from './solo-controls';
import type { useLaneRunActions } from './use-lane-runs';
import { useSoloActions } from './use-solo';

/**
 * The Run scripts section of a Solo-mode repository: no Start in the lane's
 * checkout, but the Solo controls; and while this lane holds the root, its
 * run script rows, whose Start and Restart act on the Solo runs in the root.
 */
export function SoloRunScripts({
  view,
  repoId,
  solo,
  actions,
}: {
  view: LaneRunView;
  repoId: string;
  solo: SoloView;
  actions: ReturnType<typeof useLaneRunActions>;
}) {
  const soloActions = useSoloActions(view.laneId, repoId);
  const holding = solo.holder?.laneId === view.laneId;

  return (
    <RailSection sectionId="run-scripts" title="Run scripts" count={view.scripts.length}>
      <SoloControls
        solo={solo}
        laneId={view.laneId}
        error={soloActions.error}
        pending={soloActions.pending}
        onSolo={() => void soloActions.solo()}
        onLeaveQueue={() => void soloActions.leaveQueue()}
        onSync={() => void soloActions.sync()}
        onRelease={(discard) => void soloActions.release(discard)}
      />
      {holding &&
        view.scripts.map((script) => {
          const state = view.runs.scripts[script.id];
          const key = `run:${script.id}`;
          return (
            <RunScriptRow
              key={script.id}
              title={script.title}
              state={state}
              error={actions.errors[key] ?? null}
              pending={actions.pending.has(key)}
              onStart={() => void actions.restartInRoot(script.id)}
              onStop={() => void actions.stop(script.id)}
              onRestart={() => void actions.restartInRoot(script.id)}
              onOpenUrl={(url) => void rpc.app.openExternal(url)}
              renderTerminal={(id) => <RunTerminal key={state?.startedAt} ptySessionId={id} />}
            />
          );
        })}
      {holding && (
        <p className="px-3 pt-1 font-mono text-list-meta text-text-passive">
          {formatPortBlock(view.ports)}
        </p>
      )}
    </RailSection>
  );
}
