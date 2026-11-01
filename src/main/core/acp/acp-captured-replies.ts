// Real `session/new` replies, captured 2026-09-23 from opencode-ai (`opencode
// acp`) and @agentclientprotocol/claude-agent-acp on this machine.
export const OPENCODE_CONFIG_OPTIONS = [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'opencode/big-pickle',
    options: [
      { value: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' },
      { value: 'opencode/ling-3.0-flash-fin-free', name: 'OpenCode Zen/Ling 3.0 Flash Fin Free' },
      { value: 'opencode/mimo-v2.6-flash-free', name: 'OpenCode Zen/MiMo-V2.6-Flash Free' },
      {
        value: 'opencode/muse-spark-1.2-contributor-free',
        name: 'OpenCode Zen/Muse Spark 1.2 Free',
      },
      {
        value: 'opencode/muse-spark-1.3-contributor-free',
        name: 'OpenCode Zen/Muse Spark 1.3 Free',
      },
      { value: 'opencode/nemotron-3-ultra-free', name: 'OpenCode Zen/Nemotron 3 Ultra Free' },
      {
        value: 'opencode/nemotron-3.5-lightning-free',
        name: 'OpenCode Zen/Nemotron 3.5 Lightning Free',
      },
    ],
  },
  {
    id: 'mode',
    name: 'Session Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'build',
    options: [
      {
        value: 'build',
        name: 'build',
        description: 'The default agent. Executes tools based on configured permissions.',
      },
      { value: 'plan', name: 'plan', description: 'Plan mode. Disallows all edit tools.' },
    ],
  },
];

export const CLAUDE_MODES = {
  currentModeId: 'default',
  availableModes: [
    {
      id: 'auto',
      name: 'Auto',
      description: 'Use a model classifier to approve/deny permission prompts',
    },
    {
      id: 'default',
      name: 'Default',
      description: 'Standard behavior, prompts for dangerous operations',
    },
    { id: 'acceptEdits', name: 'Accept Edits', description: 'Auto-accept file edit operations' },
    { id: 'plan', name: 'Plan Mode', description: 'Planning mode, no actual tool execution' },
    {
      id: 'dontAsk',
      name: "Don't Ask",
      description: "Don't prompt for permissions, deny if not pre-approved",
    },
    {
      id: 'bypassPermissions',
      name: 'Bypass Permissions',
      description: 'Bypass all permission checks',
    },
  ],
};

export const CLAUDE_MODELS = {
  currentModelId: 'claude-fable-5-1[1m]',
  availableModels: [
    {
      modelId: 'default',
      name: 'Default (recommended)',
      description: 'Opus 5.5 with 1M context · Best for everyday, complex tasks',
    },
    {
      modelId: 'opus[1m]',
      name: 'Opus (1M context)',
      description: 'Opus 5.5 with 1M context · Best for everyday, complex tasks',
    },
    {
      modelId: 'claude-fable-5-1[1m]',
      name: 'Fable',
      description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    },
    { modelId: 'sonnet', name: 'Sonnet', description: 'Sonnet 5 · Efficient for routine tasks' },
    { modelId: 'haiku', name: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
  ],
};

export const CLAUDE_EFFORT_LEVELS = [
  { value: 'low', name: 'Low' },
  { value: 'medium', name: 'Medium' },
  { value: 'high', name: 'High' },
  { value: 'xhigh', name: 'Xhigh' },
  { value: 'max', name: 'Max' },
];

export function claudeConfigOptions(model: string, effort: string, mode: string) {
  return [
    {
      id: 'mode',
      name: 'Mode',
      description: 'Session permission mode',
      category: 'mode',
      type: 'select',
      currentValue: mode,
      options: CLAUDE_MODES.availableModes.map((m) => ({
        value: m.id,
        name: m.name,
        description: m.description,
      })),
    },
    {
      id: 'model',
      name: 'Model',
      description: 'AI model to use',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: CLAUDE_MODELS.availableModels.map((m) => ({
        value: m.modelId,
        name: m.name,
        description: m.description,
      })),
    },
    {
      id: 'effort',
      name: 'Effort',
      description: 'Available effort levels for this model',
      category: 'thought_level',
      type: 'select',
      currentValue: effort,
      options: CLAUDE_EFFORT_LEVELS,
    },
  ];
}

export const CLAUDE_NEW_SESSION = {
  models: CLAUDE_MODELS,
  modes: CLAUDE_MODES,
  configOptions: claudeConfigOptions('claude-fable-5-1[1m]', 'medium', 'default'),
};

// Real `session/prompt` replies from the same capture: the turn's token
// usage rides on the reply, not on a notification.
export const OPENCODE_PROMPT_REPLY = {
  stopReason: 'end_turn',
  usage: { inputTokens: 18058, outputTokens: 3, totalTokens: 19853, cachedReadTokens: 1792 },
  _meta: {},
};

export const CLAUDE_PROMPT_REPLY = {
  stopReason: 'end_turn',
  usage: {
    inputTokens: 2,
    outputTokens: 4,
    cachedReadTokens: 0,
    cachedWriteTokens: 21287,
    totalTokens: 21293,
  },
};
