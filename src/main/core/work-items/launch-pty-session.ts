import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { buildModelArgs } from '@shared/agent-models';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import type { PreferredArtifactFormat } from '@shared/artifact-formats';
import { renderClassForArtifactType } from '@shared/artifact-render-class';
import { resolveProfileDir } from '@main/app/profile';
import {
  buildChordCliLaunch,
  CHORD_TOOLS_TERMINAL_CLIS,
  type ChordCliLaunch,
} from '@main/core/agent-artifact-tools/chord-cli-launch';
import { openChordMcpAccess } from '@main/core/agent-artifact-tools/chord-mcp-access';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { wireAgentClassifier } from '@main/core/agent-hooks/classifier-wiring';
import { claudeTrustService } from '@main/core/agent-hooks/claude-trust-service';
import { prepareAgentHookLaunch, type AgentHookLaunch } from '@main/core/agent-hooks/hook-config';
import { maybeTrustCodexLane } from '@main/core/agent-hooks/maybe-trust-codex-lane';
import { scheduleKeystrokeInjection } from '@main/core/agent-sessions/keystroke-injection';
import { resolveSessionCommandArgs } from '@main/core/agent-sessions/resolve-session-command';
import {
  spillPromptForCommandLine,
  type SpillResult,
} from '@main/core/agent-sessions/spill-prompt';
import { pushArtifactContentToRenderer } from '@main/core/artifacts/push-to-yjs';
import { startBridge, stopBridge } from '@main/core/chat-messages/pty-chat-bridge';
import { buildClaudeFlagSettings } from '@main/core/claude-sdk/claude-flag-settings';
import { buildAgentCommand } from '@main/core/conversations/impl/agent-command';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildAgentEnv, getTerminalColorEnv } from '@main/core/pty/pty-env';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import {
  localCommandRunsThroughCmdExe,
  resolveLocalPtySpawn,
} from '@main/core/pty/pty-spawn-platform';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { askScriptApproval } from '@main/core/workspaces/ask-script-approval';
import { resolveAgentStartApproval } from '@main/core/worktrees/lane-agent-start';
import { resolveSessionWorktreeRow } from '@main/core/worktrees/worktree-lookup';
import { log } from '@main/lib/logger';
import type { SessionLifecycleCallbacks } from './session-lifecycle-types';

export interface LaunchPtyOpts {
  workItemId: string;
  cwd: string;
  providerId: AgentProviderId;
  kind: 'chat' | 'terminal';
  initialPrompt?: string;
  isResuming?: boolean;
  externalSessionId?: string;
  previouslyStarted: boolean;
  taskEnvVars?: Record<string, string>;
  /** Work-item model/effort selection, already resolved for this provider. */
  model?: string;
  effort?: string;
  /** Settings › Agents › Artifacts at launch; null while "Let agents create artifacts" is off. */
  artifactTools: { preferredFormat: PreferredArtifactFormat } | null;
}

/**
 * The chord tools for a CLI in a PTY (plan 2026-09-23 P3 step 4), passed
 * through the CLI's own flags. A publish has no chat turn to put a card in;
 * the artifact appears in the work item's list, and an open document gets the
 * new content.
 */
async function openTerminalChordTools(
  sessionId: string,
  opts: LaunchPtyOpts,
  launchDir: string
): Promise<{ launch: ChordCliLaunch; dispose: () => void } | null> {
  if (!opts.artifactTools) return null;
  if (!(CHORD_TOOLS_TERMINAL_CLIS as readonly string[]).includes(opts.providerId)) return null;
  const access = await openChordMcpAccess({
    sessionId,
    workItemId: opts.workItemId,
    cwd: opts.cwd,
    preferredFormat: opts.artifactTools.preferredFormat,
    onPublished: (result) => {
      if (renderClassForArtifactType(result.format) === 'document') {
        pushArtifactContentToRenderer(opts.workItemId, result.artifact_id, result.path);
      }
    },
  });
  const launch = buildChordCliLaunch(opts.providerId, access, sessionId, launchDir)!;
  return {
    launch,
    dispose: () => {
      launch.cleanup();
      access.dispose();
    },
  };
}

export interface LaunchPtyResult {
  ptyId: string;
  externalSessionId: string;
  onExit: (handler: (exitCode: number | undefined) => void) => void;
}

function makePtyId(sessionId: string): string {
  return `session:${sessionId}`;
}

export async function launchPtyProcess(
  sessionId: string,
  opts: LaunchPtyOpts,
  callbacks: SessionLifecycleCallbacks
): Promise<LaunchPtyResult> {
  const pid = makePtyId(sessionId);

  // What this start may run from the repository (asking about it if it is
  // unapproved): shellSetup for the shell, and the repository's Claude config.
  const start = await resolveAgentStartApproval(
    resolveSessionWorktreeRow(sessionId).id,
    { claudeSession: opts.providerId === 'claude', shell: true, platform: process.platform },
    askScriptApproval
  );

  // Pre-accepting Claude's own trust dialog is legitimate only when there is
  // nothing it would protect (no repository Claude config that runs code) or
  // the user approved exactly that config here — otherwise Claude asks itself.
  if (start.approved || Object.keys(start.claude).length === 0) {
    await claudeTrustService.maybeAutoTrustLocal({
      providerId: opts.providerId,
      cwd: opts.cwd,
      homedir: homedir(),
    });
  }
  // Codex's own folder trust, likewise (devstation-xr1); a lane with the
  // repository's own Codex config is left for Codex to ask about.
  await maybeTrustCodexLane({ providerId: opts.providerId, cwd: opts.cwd });

  const rawResuming = opts.isResuming ?? opts.previouslyStarted;
  // A new session's CLI id is its own session id: two sessions sharing one
  // would collide on `--session-id` (and a second chat would take over the
  // first one's conversation). Older chats that used the work item id carry
  // it in their row's external id, which is passed back in on resume.
  const rawExternalId = opts.externalSessionId ?? sessionId;

  const resolved_cmd = resolveSessionCommandArgs({
    providerId: opts.providerId,
    sessionId: sessionId,
    externalSessionId: rawExternalId,
    isResuming: rawResuming,
  });
  const isResuming = resolved_cmd.isResuming;
  const resumeSessionId = resolved_cmd.sessionId;

  const providerDef = getProvider(opts.providerId);
  const useKeystroke = providerDef?.useKeystrokeInjection === true;

  const buildCommand = (initialPrompt: string | undefined) =>
    buildAgentCommand({
      providerId: opts.providerId,
      initialPrompt,
      sessionId: resumeSessionId,
      isResuming,
    });
  // The first prompt goes on the command line, or in a file when that line
  // cannot carry it as typed (too large, or line breaks through cmd.exe).
  const promptArg = isResuming || useKeystroke ? undefined : opts.initialPrompt || undefined;
  let { command, args } = await buildCommand(promptArg);
  let spill: SpillResult | undefined;
  if (promptArg) {
    spill = await spillPromptForCommandLine(promptArg, {
      lineBreaksAllowed: !localCommandRunsThroughCmdExe({
        command,
        cwd: opts.cwd,
        platform: process.platform,
        env: process.env,
      }),
    });
    if (spill.prompt !== promptArg) ({ command, args } = await buildCommand(spill.prompt));
  }
  args.push(
    ...buildModelArgs(opts.providerId, {
      model: opts.model ?? null,
      effort: opts.effort ?? null,
    })
  );
  const launchDir = join(resolveProfileDir(), 'agent-launch');
  const chordTools = await openTerminalChordTools(sessionId, opts, launchDir);
  if (chordTools) args.unshift(...chordTools.launch.args);

  // Chord's hooks go in through the CLI's flags, never into the checkout.
  let hookLaunch: AgentHookLaunch;
  try {
    hookLaunch = await prepareAgentHookLaunch({
      providerId: opts.providerId,
      sessionId,
      cwd: opts.cwd,
      launchDir,
      claudeSettings: buildClaudeFlagSettings({
        fast: false,
        chordArtifactsEnabled: chordTools !== null,
      }),
      platform: process.platform,
    });
  } catch (error) {
    void spill?.cleanup();
    chordTools?.dispose();
    throw error;
  }
  args.unshift(...hookLaunch.args);

  // `.chord.json` at the lane's target ref, only when approved — never the
  // checkout's own copy, which the agent can edit.
  const { shellSetup } = start;

  const resolved = resolveLocalPtySpawn({
    platform: process.platform,
    env: process.env,
    intent: {
      kind: 'run-command',
      cwd: opts.cwd,
      command: { kind: 'argv', command, args },
      shellSetup,
    },
  });

  const port = agentHookService.getPort();
  const token = agentHookService.getToken();

  const providerConfig = await providerOverrideSettings.getItem(opts.providerId);
  const providerEnv = providerConfig?.env ?? {};

  const lastSize = ptySessionRegistry.getLastSize(pid);

  let pty;
  try {
    pty = spawnLocalPty({
      id: pid,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: {
        ...buildAgentEnv({
          hook: port > 0 ? { port, ptyId: pid, token } : undefined,
        }),
        ...getTerminalColorEnv(),
        ...providerEnv,
        ...(opts.taskEnvVars ?? {}),
        ...(chordTools?.launch.env ?? {}),
      },
      cols: lastSize?.cols ?? 120,
      rows: lastSize?.rows ?? 40,
    });
  } catch (error) {
    void spill?.cleanup();
    chordTools?.dispose();
    hookLaunch.cleanup();
    throw error;
  }

  ptySessionRegistry.register(pid, pty);

  const hookActive = port > 0;
  const useHooksOnly = hookActive && providerDef?.supportsHooks;
  if (!useHooksOnly) {
    wireAgentClassifier({
      pty,
      providerId: opts.providerId,
      projectId: opts.workItemId,
      taskId: opts.workItemId,
      conversationId: sessionId,
    });
  }

  if (opts.kind === 'chat') {
    startBridge(opts.workItemId, pty, getAgentDisplayName(opts.providerId), sessionId);
  }

  pty.onExit(({ exitCode }) => {
    void spill?.cleanup();
    chordTools?.dispose();
    hookLaunch.cleanup();
    if (opts.kind === 'chat') {
      stopBridge(sessionId);
    }
    ptySessionRegistry.unregister(pid);
    callbacks.onExit(exitCode);
  });

  scheduleKeystrokeInjection({
    pty,
    sessionId,
    providerId: opts.providerId,
    initialPrompt: opts.initialPrompt,
    isResuming,
  });

  log.info('session-service: started PTY session', { sessionId, providerId: opts.providerId });

  return {
    ptyId: pid,
    externalSessionId: resumeSessionId,
    onExit: () => {},
  };
}
