/**
 * Every agent Chord knows, in the order agent lists show them (onboarding,
 * Settings, the + menu). Each has one definition, in `agent-providers-chat`
 * or `agent-providers-terminal`; `agent-providers` holds the lookups.
 */
export const AGENT_PROVIDER_IDS = [
  'codex',
  'claude',
  'devin',
  'cursor',
  'gemini',
  'qwen',
  'droid',
  'amp',
  'opencode',
  'hermes',
  'copilot',
  'charm',
  'auggie',
  'goose',
  'kimi',
  'kilocode',
  'kiro',
  'rovo',
  'cline',
  'continue',
  'codebuff',
  'mistral',
  'pi',
  'autohand',
  'roo',
] as const;

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

export type AgentProviderDefinition = {
  id: AgentProviderId;
  name: string;
  /** Short one-liner shown in the agent info card. */
  description?: string;
  docUrl?: string;
  /** The vendor's installer as a POSIX shell line (macOS, Linux). */
  installCommand?: string;
  /**
   * The vendor's installer on Windows, where a `curl … | bash` line cannot
   * run: a line for cmd.exe, or null when the vendor publishes none. Left out
   * where `installCommand` runs as it is on Windows (npm, uv). Resolve with
   * `resolveInstallCommand` (devstation-fez).
   */
  windowsInstallCommand?: string | null;
  /**
   * The npm package the agent is published as. An install that is npm's global
   * install of this package is updated with `npm install -g <pkg>@latest`.
   */
  npmPackage?: string;
  commands?: string[];
  versionArgs?: string[];
  /**
   * Environment for the version probe, layered over the inherited one. Set
   * where reading the version would otherwise run the CLI's self-updater.
   */
  versionProbeEnv?: Record<string, string>;
  detectable?: boolean;
  cli?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  /**
   * When true, the initial prompt is delivered via keystroke injection
   * (typing into the TUI after startup) instead of as a CLI argument.
   * Use for agents whose CLI has no flag for interactive-mode prompt delivery.
   */
  useKeystrokeInjection?: boolean;
  resumeFlag?: string;
  /**
   * CLI flag to assign a unique session ID per chat instance.
   * Used to isolate session state when multiple chats of the same provider
   * run in the same worktree. The flag receives a deterministic UUID
   * derived from the Chord conversation ID.
   * e.g. '--session-id' for Claude Code.
   */
  sessionIdFlag?: string;
  defaultArgs?: string[];
  planActivateCommand?: string;
  autoStartCommand?: string;
  icon?: string;
  /** Accessible alt text for the provider logo. */
  alt?: string;
  /** When true, the logo should be colour-inverted in dark mode. */
  invertInDark?: boolean;
  terminalOnly?: boolean;
  supportsHooks?: boolean;
  /** How a chat session talks to the agent; `app-server` is Codex's own JSON-RPC server. */
  communication?: 'acp' | 'pty' | 'app-server';
  acpConfig?: {
    bridge: string;
    acpArgs?: string[];
    usesNpx?: boolean;
    initTimeoutMs?: number;
    promptTimeoutMs?: number;
  };
};

/**
 * The install command for `platform`: the vendor's Windows installer on
 * Windows, where one is declared (null: the vendor publishes none), else the
 * shell line, which then runs everywhere (devstation-fez).
 */
export function resolveInstallCommand(
  provider: Pick<AgentProviderDefinition, 'installCommand' | 'windowsInstallCommand'>,
  platform: NodeJS.Platform
): string | null {
  if (platform === 'win32' && provider.windowsInstallCommand !== undefined) {
    return provider.windowsInstallCommand;
  }
  return provider.installCommand ?? null;
}

/**
 * Validates if a string is a valid provider ID.
 * @param value - The value to validate
 * @returns true if the value is a valid provider ID, false otherwise
 */
export function isValidProviderId(value: unknown): value is AgentProviderId {
  return typeof value === 'string' && AGENT_PROVIDER_IDS.includes(value as AgentProviderId);
}
