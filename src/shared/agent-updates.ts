import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { InstallCommandError } from '@shared/dependencies';
import type { Result } from '@shared/result';

/** Where an agent's latest version is read — the source its own updater uses. */
export type AgentLatestSource =
  | { kind: 'codex-channel'; url: string }
  | { kind: 'npm'; package: string };

/** An installed agent that Chord can update, with the versions it compared. */
export interface AgentUpdateInfo {
  id: AgentProviderId;
  installedVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  source: AgentLatestSource;
  checkedAt: number;
}

/** An agent whose update check could not complete, and why. */
export interface AgentUpdateCheckFailure {
  id: AgentProviderId;
  message: string;
}

export interface AgentUpdateCheckResult {
  updates: AgentUpdateInfo[];
  failures: AgentUpdateCheckFailure[];
}

export type AgentUpdateError =
  | { type: 'unknown-agent'; id: string }
  | { type: 'not-installed'; id: AgentProviderId }
  | { type: 'no-update-spec'; id: AgentProviderId }
  | InstallCommandError
  | { type: 'version-unchanged'; id: AgentProviderId; version: string; output: string };

export type AgentUpdateResult = Result<{ version: string; output: string }, AgentUpdateError>;
