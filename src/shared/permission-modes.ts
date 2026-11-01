/**
 * How freely an agent may act — ask before edits, accept edits, plan first,
 * full access — as one list per provider. The composer's mode menu renders
 * these; the provider's own id is what reaches the agent.
 */
export interface PermissionModeOption {
  /** The provider's own mode id: a Claude `PermissionMode`, an ACP mode, a Codex mode below. */
  id: string;
  label: string;
  description?: string;
  /** The mode a session runs in until one is picked. Exactly one per list. */
  isDefault: boolean;
  /** The agent explores and presents a plan for approval before changing anything. */
  isPlan: boolean;
  /** The agent acts without asking and outside any sandbox. */
  danger: boolean;
  /** Only these models run the mode; absent = every model. */
  models?: string[];
}

/**
 * Claude Code's modes, in its own Shift+Tab order, full access last. `auto`
 * is offered on the models that report `supportsAutoMode`. `dontAsk` is left
 * out: it denies everything not pre-approved by permission rules, and Chord
 * has no rules to pre-approve with, so it would only fail turns.
 */
export function claudePermissionModes(autoModelIds: readonly string[]): PermissionModeOption[] {
  const modes: PermissionModeOption[] = [
    {
      id: 'default',
      label: 'Ask before edits',
      description: 'Asks before editing files or running commands',
      isDefault: true,
      isPlan: false,
      danger: false,
    },
    {
      id: 'acceptEdits',
      label: 'Accept edits',
      description: 'Edits files without asking; asks before commands',
      isDefault: false,
      isPlan: false,
      danger: false,
    },
  ];
  if (autoModelIds.length > 0) {
    modes.push({
      id: 'auto',
      label: 'Auto',
      description: 'A classifier approves or denies each action',
      isDefault: false,
      isPlan: false,
      danger: false,
      models: [...autoModelIds],
    });
  }
  modes.push(
    {
      id: 'plan',
      label: 'Plan',
      description: 'Proposes a plan for approval before changing anything',
      isDefault: false,
      isPlan: true,
      danger: false,
    },
    {
      id: 'bypassPermissions',
      label: 'Full access',
      description: 'Runs everything without asking',
      isDefault: false,
      isPlan: false,
      danger: true,
    }
  );
  return modes;
}

/**
 * Codex's modes, after the Codex app's own: each is an approval policy and a
 * sandbox sent with every turn (`codex-turn-overrides.ts`); plan also sets
 * the plan collaboration mode.
 */
export const CODEX_PERMISSION_MODES: readonly PermissionModeOption[] = [
  {
    id: 'read-only',
    label: 'Read only',
    description: 'Reads files; asks before changing anything',
    isDefault: false,
    isPlan: false,
    danger: false,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Works in the workspace; asks before stepping outside it',
    isDefault: true,
    isPlan: false,
    danger: false,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Proposes a plan for approval before changing anything',
    isDefault: false,
    isPlan: true,
    danger: false,
  },
  {
    id: 'full-access',
    label: 'Full access',
    description: 'Runs anything, anywhere, without asking',
    isDefault: false,
    isPlan: false,
    danger: true,
  },
];

/** The modes `modelId` runs; with no known model, only the modes every model runs. */
export function modesForModel(
  modes: readonly PermissionModeOption[],
  modelId: string | undefined
): PermissionModeOption[] {
  return modes.filter((m) => !m.models || (modelId !== undefined && m.models.includes(modelId)));
}

/**
 * The mode pick a session runs: its own, else the agent's saved default
 * (Settings › Agents), else null — the catalog's default. Still to be
 * resolved against the session's catalog, like any pick.
 */
export function pickPermissionMode(
  sessionPick: string | null,
  savedDefaults: Partial<Record<string, string>>,
  providerId: string
): string | null {
  return sessionPick ?? savedDefaults[providerId] ?? null;
}
