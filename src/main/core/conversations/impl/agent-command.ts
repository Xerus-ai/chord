import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import { resolveAgentExecutable } from '@main/core/agent-sessions/resolve-agent-executable';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';

/**
 * Codex checks for a newer release at startup and, finding one, opens on its
 * own update prompt, whose "Update now" runs an installer inside the lane
 * (devstation-v6v). Chord launches it with the check off — a top-level Codex
 * config key, as a `-c` override ahead of any subcommand (`resume --last`).
 * Not in the provider's `defaultArgs`: a user's provider settings replace
 * those, and they go after the prompt.
 */
const CODEX_LAUNCH_ARGS = ['-c', 'check_for_update_on_startup=false'];

export async function buildAgentCommand({
  providerId,
  autoApprove,
  initialPrompt,
  sessionId,
  isResuming,
}: {
  providerId: AgentProviderId;
  autoApprove?: boolean;
  initialPrompt?: string;
  sessionId: string;
  isResuming?: boolean;
}) {
  const providerConfig = await providerOverrideSettings.getItem(providerId);
  const providerDef = getProvider(providerId);

  const command = await resolveAgentExecutable({
    providerId,
    cli: providerConfig?.cli ?? providerDef?.cli,
  });
  const args: string[] = providerId === 'codex' ? [...CODEX_LAUNCH_ARGS] : [];

  if (isResuming && providerConfig?.resumeFlag) {
    args.push(...providerConfig.resumeFlag.split(' '));
    if (providerConfig?.sessionIdFlag) {
      args.push(sessionId);
    }
  } else if (providerConfig?.sessionIdFlag) {
    args.push(providerConfig.sessionIdFlag, sessionId);
  }

  if (autoApprove && providerConfig?.autoApproveFlag) {
    args.push(providerConfig.autoApproveFlag);
  }

  if (!isResuming && initialPrompt && !providerDef?.useKeystrokeInjection) {
    const flag = providerConfig?.initialPromptFlag;
    if (flag) {
      args.push(flag, initialPrompt);
    } else {
      args.push(initialPrompt);
    }
  }

  args.push(...(providerConfig?.defaultArgs ?? []));

  return { command, args };
}
