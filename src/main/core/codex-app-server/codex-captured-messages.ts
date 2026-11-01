// Real Codex app-server (codex-cli 0.154.0) messages, captured 2026-09-23 on
// this machine: `model/list`, a plain turn, a plan-mode turn, and a turn that
// ran a shell command and wrote a file under the `untrusted` approval policy.
import type { AccountRateLimitsUpdatedNotification } from './protocol/v2/AccountRateLimitsUpdatedNotification';
import type { AgentMessageDeltaNotification } from './protocol/v2/AgentMessageDeltaNotification';
import type { CommandExecutionRequestApprovalParams } from './protocol/v2/CommandExecutionRequestApprovalParams';
import type { FileChangeRequestApprovalParams } from './protocol/v2/FileChangeRequestApprovalParams';
import type { ItemCompletedNotification } from './protocol/v2/ItemCompletedNotification';
import type { ItemStartedNotification } from './protocol/v2/ItemStartedNotification';
import type { Model } from './protocol/v2/Model';
import type { ThreadStartResponse } from './protocol/v2/ThreadStartResponse';
import type { ThreadTokenUsageUpdatedNotification } from './protocol/v2/ThreadTokenUsageUpdatedNotification';
import type { TurnCompletedNotification } from './protocol/v2/TurnCompletedNotification';

export const CODEX_MODELS: Model[] = [
  {
    id: 'gpt-6-astra',
    model: 'gpt-6-astra',
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: {
      message:
        "This is GPT-6, a new generation of intelligence. Astra is state-of-the-art in coding, computer use, science, and professional work. Give it a hard problem, a half-formed idea, or anything you've been meaning to build. See where it takes you.",
    },
    displayName: 'GPT-6-Astra',
    description: 'Our most capable model for complex, demanding work.',
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'low',
        description: 'Fast responses with lighter reasoning',
      },
      {
        reasoningEffort: 'medium',
        description: 'Balances speed and reasoning depth for everyday tasks',
      },
      {
        reasoningEffort: 'high',
        description: 'Greater reasoning depth for complex problems',
      },
      {
        reasoningEffort: 'xhigh',
        description: 'Extra high reasoning depth for complex problems',
      },
      {
        reasoningEffort: 'max',
        description: 'Maximum reasoning depth for the hardest problems',
      },
      {
        reasoningEffort: 'ultra',
        description: 'Maximum reasoning with automatic task delegation',
      },
    ],
    defaultReasoningEffort: 'low',
    inputModalities: ['text', 'image'],
    supportsPersonality: false,
    multiAgentVersion: 'v2',
    additionalSpeedTiers: ['fast'],
    serviceTiers: [
      {
        id: 'priority',
        name: 'Fast',
        description: '2x speed, increased usage',
      },
    ],
    defaultServiceTier: null,
    isDefault: true,
  },
  {
    id: 'gpt-5.5',
    model: 'gpt-5.5',
    upgrade: 'gpt-5.6-sol',
    upgradeInfo: {
      model: 'gpt-5.6-sol',
      upgradeCopy: null,
      modelLink: null,
      migrationMarkdown:
        'GPT-5.5 retires on October 14, 2026. Switch to GPT-5.6 Sol to continue working in Codex.',
      retirementAt: 1792004400,
    },
    availabilityNux: null,
    displayName: 'GPT-5.5',
    description: 'Proven previous-generation model for coding and general work.',
    modelSpecialty: null,
    hidden: false,
    supportedReasoningEfforts: [
      {
        reasoningEffort: 'low',
        description: 'Fast responses with lighter reasoning',
      },
      {
        reasoningEffort: 'medium',
        description: 'Balances speed and reasoning depth for everyday tasks',
      },
      {
        reasoningEffort: 'high',
        description: 'Greater reasoning depth for complex problems',
      },
      {
        reasoningEffort: 'xhigh',
        description: 'Extra high reasoning depth for complex problems',
      },
    ],
    defaultReasoningEffort: 'medium',
    inputModalities: ['text', 'image'],
    supportsPersonality: false,
    multiAgentVersion: null,
    additionalSpeedTiers: ['fast'],
    serviceTiers: [
      {
        id: 'priority',
        name: 'Fast',
        description: '1.5x speed, increased usage',
      },
    ],
    defaultServiceTier: null,
    isDefault: false,
  },
];

export const AGENT_MESSAGE_STARTED: ItemStartedNotification = {
  item: {
    type: 'agentMessage',
    id: 'msg_05bc5c9f64d1b222016ab2e50b34fc87d0a080478601ba40d5',
    text: '',
    phase: 'final_answer',
    memoryCitation: null,
    delivery: null,
    questions: null,
  },
  threadId: '01a0cace-91cc-7361-b0b9-4e5fc6b348e0',
  turnId: '01a0cace-933e-7cb1-86fc-1644698c3c58',
  startedAtMs: 1790108937385,
};

export const AGENT_MESSAGE_DELTA: AgentMessageDeltaNotification = {
  threadId: '01a0cace-91cc-7361-b0b9-4e5fc6b348e0',
  turnId: '01a0cace-933e-7cb1-86fc-1644698c3c58',
  itemId: 'msg_05bc5c9f64d1b222016ab2e50b34fc87d0a080478601ba40d5',
  delta: 'OK',
};

export const COMMAND_STARTED: ItemStartedNotification = {
  item: {
    type: 'commandExecution',
    id: 'exec-13fce3e4-9a29-4ea3-bc1a-baf63ccf5b8f',
    pluginId: null,
    scriptPath: null,
    command:
      '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'echo hi\'',
    cwd: 'C:\\Users\\dev\\AppData\\Local\\Temp\\codex-proto\\ws',
    processId: null,
    source: 'agent',
    status: 'inProgress',
    commandActions: [
      {
        type: 'unknown',
        command: 'echo hi',
      },
    ],
    aggregatedOutput: null,
    exitCode: null,
    durationMs: null,
  },
  threadId: '01a0cad0-9ba5-7d83-9126-4515dbea83e8',
  turnId: '01a0cad0-9bea-7570-865c-36bdcc36d35c',
  startedAtMs: 1790109071434,
};

export const COMMAND_COMPLETED: ItemCompletedNotification = {
  item: {
    type: 'commandExecution',
    id: 'exec-13fce3e4-9a29-4ea3-bc1a-baf63ccf5b8f',
    pluginId: null,
    scriptPath: null,
    command:
      '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'echo hi\'',
    cwd: 'C:\\Users\\dev\\AppData\\Local\\Temp\\codex-proto\\ws',
    processId: '4669',
    source: 'unifiedExecStartup',
    status: 'completed',
    commandActions: [
      {
        type: 'unknown',
        command: 'echo hi',
      },
    ],
    aggregatedOutput: 'hi\r\n',
    exitCode: 0,
    durationMs: 104,
  },
  threadId: '01a0cad0-9ba5-7d83-9126-4515dbea83e8',
  turnId: '01a0cad0-9bea-7570-865c-36bdcc36d35c',
  completedAtMs: 1790109071730,
};

export const COMMAND_APPROVAL: CommandExecutionRequestApprovalParams = {
  kind: 'command',
  threadId: '01a0cad0-9ba5-7d83-9126-4515dbea83e8',
  turnId: '01a0cad0-9bea-7570-865c-36bdcc36d35c',
  itemId: 'exec-13fce3e4-9a29-4ea3-bc1a-baf63ccf5b8f',
  startedAtMs: 1790109071433,
  environmentId: 'local',
  command:
    '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'echo hi\'',
  cwd: 'C:\\Users\\dev\\AppData\\Local\\Temp\\codex-proto\\ws',
  commandActions: [
    {
      type: 'unknown',
      command: 'echo hi',
    },
  ],
  proposedExecpolicyAmendment: ['echo', 'hi'],
  availableDecisions: [
    'accept',
    {
      acceptWithExecpolicyAmendment: {
        execpolicy_amendment: ['echo', 'hi'],
      },
    },
    'cancel',
  ],
};

export const FILE_CHANGE_STARTED: ItemStartedNotification = {
  item: {
    type: 'fileChange',
    id: 'exec-112528cc-2382-4d29-9cc0-88936617cb4e',
    changes: [
      {
        path: 'C:\\Users\\dev\\AppData\\Local\\Temp\\codex-proto\\ws\\hello.txt',
        kind: {
          type: 'add',
        },
        diff: 'hi\n',
      },
    ],
    status: 'inProgress',
  },
  threadId: '01a0cad0-9ba5-7d83-9126-4515dbea83e8',
  turnId: '01a0cad0-9bea-7570-865c-36bdcc36d35c',
  startedAtMs: 1790109072188,
};

export const FILE_CHANGE_COMPLETED: ItemCompletedNotification = {
  item: {
    type: 'fileChange',
    id: 'exec-112528cc-2382-4d29-9cc0-88936617cb4e',
    changes: [
      {
        path: 'C:\\Users\\dev\\AppData\\Local\\Temp\\codex-proto\\ws\\hello.txt',
        kind: {
          type: 'add',
        },
        diff: 'hi\n',
      },
    ],
    status: 'completed',
  },
  threadId: '01a0cad0-9ba5-7d83-9126-4515dbea83e8',
  turnId: '01a0cad0-9bea-7570-865c-36bdcc36d35c',
  completedAtMs: 1790109072605,
};

export const FILE_CHANGE_APPROVAL: FileChangeRequestApprovalParams = {
  threadId: '01a0cad0-9ba5-7d83-9126-4515dbea83e8',
  turnId: '01a0cad0-9bea-7570-865c-36bdcc36d35c',
  itemId: 'exec-112528cc-2382-4d29-9cc0-88936617cb4e',
  startedAtMs: 1790109072402,
  reason: null,
  grantRoot: null,
};

export const PLAN_COMPLETED: ItemCompletedNotification = {
  item: {
    type: 'plan',
    id: '01a0cace-aee1-79a0-ad36-4cc51eb8fafc-plan',
    text: '1. Create `hello.txt` in the workspace root containing `Hello, world!` followed by a newline.\n2. Verify the file exists and its contents match.\n',
  },
  threadId: '01a0cace-91cc-7361-b0b9-4e5fc6b348e0',
  turnId: '01a0cace-aee1-79a0-ad36-4cc51eb8fafc',
  completedAtMs: 1790108942824,
};

export const TOKEN_USAGE_UPDATED: ThreadTokenUsageUpdatedNotification = {
  threadId: '01a0cace-91cc-7361-b0b9-4e5fc6b348e0',
  turnId: '01a0cace-aee1-79a0-ad36-4cc51eb8fafc',
  tokenUsage: {
    total: {
      totalTokens: 33352,
      inputTokens: 33272,
      cachedInputTokens: 27904,
      cacheWriteInputTokens: 0,
      outputTokens: 80,
      reasoningOutputTokens: 25,
    },
    last: {
      totalTokens: 17628,
      inputTokens: 17553,
      cachedInputTokens: 15488,
      cacheWriteInputTokens: 0,
      outputTokens: 75,
      reasoningOutputTokens: 25,
    },
    modelContextWindow: 258400,
  },
};

export const RATE_LIMITS_UPDATED: AccountRateLimitsUpdatedNotification = {
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    normalModelSlug: null,
    primary: {
      usedPercent: 0,
      windowDurationMins: 300,
      resetsAt: 1790126936,
    },
    secondary: {
      usedPercent: 26,
      windowDurationMins: 10080,
      resetsAt: 1790446123,
    },
    credits: {
      hasCredits: false,
      unlimited: false,
      balance: '0',
    },
    individualLimit: null,
    spendControlReached: null,
    planType: 'plus',
    rateLimitReachedType: null,
  },
};

export const TURN_COMPLETED: TurnCompletedNotification = {
  threadId: '01a0cace-91cc-7361-b0b9-4e5fc6b348e0',
  turn: {
    id: '01a0cace-933e-7cb1-86fc-1644698c3c58',
    items: [
      {
        type: 'agentMessage',
        id: 'msg_05bc5c9f64d1b222016ab2e50b34fc87d0a080478601ba40d5',
        text: 'OK',
        phase: 'final_answer',
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    ],
    itemsView: 'summary',
    status: 'completed',
    error: null,
    startedAt: 1790108930,
    completedAt: 1790108937,
    durationMs: 7047,
  },
};

/**
 * The policy a `thread/start` with `on-request` + `workspace-write` answered
 * with (captured 2026-09-23): the sandbox as the user's config materialised it.
 */
export const THREAD_START_POLICY: Pick<ThreadStartResponse, 'approvalPolicy' | 'sandbox'> = {
  approvalPolicy: 'on-request',
  sandbox: {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
};
