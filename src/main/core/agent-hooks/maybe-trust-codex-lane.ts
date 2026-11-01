import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import { trustCodexLane } from './codex-folder-trust';

/**
 * Trusts the lane in Codex's config for a Codex launch (devstation-xr1) when
 * "Trust worktrees automatically" is on, the setting Claude's pre-accept
 * follows. Codex's home is `CODEX_HOME`, else `~/.codex`, as Codex resolves it.
 */
export async function maybeTrustCodexLane({
  providerId,
  cwd,
}: {
  providerId: AgentProviderId;
  cwd: string | undefined;
}): Promise<void> {
  if (providerId !== 'codex' || !cwd) return;
  const { autoTrustWorktrees } = await appSettingsService.get('tasks');
  if (!autoTrustWorktrees) return;
  const codexHome = process.env.CODEX_HOME ?? path.join(homedir(), '.codex');
  const outcome = await trustCodexLane({ cwd, codexHome });
  log.info('codex-folder-trust: lane', { cwd, outcome });
}
