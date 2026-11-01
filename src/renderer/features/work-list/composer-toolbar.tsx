import { useHotkey } from '@tanstack/react-hotkeys';
import { Plus } from 'lucide-react';
import type { RefObject } from 'react';
import { permissionModesForModel, resolvePermissionMode } from '@shared/agent-control-catalog';
import { pickPermissionMode } from '@shared/permission-modes';
import { ContextRing } from '@renderer/features/composer-controls/context-ring';
import { ModeControl } from '@renderer/features/composer-controls/mode-control';
import { ModelControl, nextEffort } from '@renderer/features/composer-controls/model-control';
import { useAgentCatalog } from '@renderer/features/composer-controls/use-agent-catalog';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  ComposerActionButton,
  ComposerActionRow,
  ComposerActionSpacer,
  ComposerSendButton,
  ComposerStopButton,
} from '@renderer/lib/components/chrome/composer-shell';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import type { AgentControls } from './chat-input';
import type { useComposerSettings } from './use-composer-settings';
import { useWorkItemWorktrees } from './use-work-item-worktrees';
import { shouldShowWorktreePill, WorktreePill } from './worktree-pill';

export type ComposerSettings = ReturnType<typeof useComposerSettings>;

/**
 * The owner's composer row: attach, the agent's model control and mode menu
 * lead; the worktree scope, the context ring and send/stop trail. Every agent
 * control renders from the provider's catalog, so a provider without
 * permission modes simply has no mode menu. Commit is not here — the right
 * rail's band owns it, one entry point per action. It reads this machine
 * (catalog, worktrees), so only a viewer who configures the agent mounts it.
 */
export function ComposerToolbar({
  workItemId,
  controls,
  composerRef,
  onAddFileReference,
  isAsideToTeammates,
  onSend,
  sendDisabled,
  sendLabel,
}: {
  workItemId: string;
  controls: AgentControls;
  /** The effort hotkey is scoped to this composer: split panes can show several. */
  composerRef: RefObject<HTMLDivElement | null>;
  onAddFileReference: () => void;
  /** A message addressed to teammates starts no turn, so Send stays a Send. */
  isAsideToTeammates: boolean;
  onSend: () => void;
  sendDisabled: boolean;
  sendLabel: string;
}) {
  const {
    sessionId,
    agent,
    settings,
    onOpenAgent,
    worktreeId,
    onWorktreeChange,
    streaming,
    onStop,
  } = controls;
  const { catalog } = useAgentCatalog(agent, sessionId);
  const worktrees = useWorkItemWorktrees(workItemId);
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const cycleEffortHotkey = getEffectiveHotkey('cycleEffort', keyboard);
  useHotkey(
    getHotkeyRegistration('cycleEffort', keyboard),
    () => {
      if (!catalog) return;
      const next = nextEffort(catalog, settings.selection);
      if (next !== undefined) settings.onEffortChange(next);
    },
    { target: composerRef, enabled: cycleEffortHotkey !== null }
  );
  const model = settings.selection.model;
  const modes = catalog ? permissionModesForModel(catalog, model) : [];
  // No pick yet: the agent's saved default, as the session will start in it.
  const { value: savedModes } = useAppSettingsKey('agentDefaultPermissionModes');
  const pick = pickPermissionMode(settings.permissionMode, savedModes ?? {}, agent);
  const mode = catalog ? resolvePermissionMode(catalog, model, pick) : null;
  return (
    <ComposerActionRow>
      <ComposerActionButton icon={Plus} ariaLabel="Reference a file" onClick={onAddFileReference} />
      <ModelControl
        sessionId={sessionId}
        agent={agent}
        selection={settings.selection}
        onModelChange={settings.onModelChange}
        onEffortChange={settings.onEffortChange}
        onFastChange={settings.onFastChange}
        onOpenAgent={onOpenAgent}
        cycleEffortHotkey={cycleEffortHotkey}
      />
      {mode && (
        <ModeControl modes={modes} current={mode} onModeChange={settings.onPermissionModeChange} />
      )}
      <ComposerActionSpacer />
      {/* The worktree choice stays, because it decides where this draft runs. */}
      {shouldShowWorktreePill(worktrees) && (
        <WorktreePill
          worktrees={worktrees ?? []}
          worktreeId={worktreeId}
          onWorktreeChange={onWorktreeChange}
        />
      )}
      <ContextRing sessionId={sessionId} providerId={agent} />
      {streaming && !isAsideToTeammates ? (
        <ComposerStopButton onClick={onStop} />
      ) : (
        <ComposerSendButton
          onClick={onSend}
          disabled={sendDisabled}
          ariaLabel={sendLabel}
          title={sendLabel}
        />
      )}
    </ComposerActionRow>
  );
}
