import type { AgentProviderDefinition } from './agent-provider-registry';

/**
 * Agents Chord also runs as a chat: over ACP, or Codex's own app server
 * (`communication`). Each runs as its CLI in a terminal too.
 */
export const CHAT_AGENT_PROVIDERS: AgentProviderDefinition[] = [
  {
    id: 'codex',
    name: 'Codex',
    description:
      'CLI that connects to OpenAI models for project-aware code assistance and terminal workflows.',
    docUrl: 'https://github.com/openai/codex',
    // OpenAI's standalone installer; without CODEX_NON_INTERACTIVE it ends
    // asking "Start Codex now?", which nothing would answer.
    installCommand: 'curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh',
    windowsInstallCommand:
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CODEX_NON_INTERACTIVE=\'1\'; irm https://chatgpt.com/codex/install.ps1 | iex"',
    npmPackage: '@openai/codex',
    commands: ['codex'],
    versionArgs: ['--version'],
    cli: 'codex',
    autoApproveFlag: '--full-auto',
    initialPromptFlag: '',
    resumeFlag: 'resume --last',
    icon: 'openai.svg',
    alt: 'Codex',
    terminalOnly: true,
    supportsHooks: true,
    communication: 'app-server',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description:
      'CLI that uses Anthropic Claude for code edits, explanations, and structured refactors in the terminal.',
    docUrl: 'https://docs.anthropic.com/claude/docs/claude-code',
    installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
    windowsInstallCommand:
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex"',
    commands: ['claude'],
    versionArgs: ['--version'],
    cli: 'claude',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '',
    resumeFlag: '--resume',
    sessionIdFlag: '--session-id',
    planActivateCommand: '/plan',
    icon: 'claude.png',
    alt: 'Claude Code',
    terminalOnly: true,
    supportsHooks: true,
    communication: 'acp',
    acpConfig: {
      bridge: '@agentclientprotocol/claude-agent-acp@0.33.1',
      usesNpx: true,
    },
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    description:
      "Command-line interface to Alibaba's Qwen Code models for coding assistance and code completion.",
    docUrl: 'https://github.com/QwenLM/qwen-code',
    installCommand: 'npm install -g @qwen-code/qwen-code',
    npmPackage: '@qwen-code/qwen-code',
    commands: ['qwen'],
    versionArgs: ['--version'],
    cli: 'qwen',
    autoApproveFlag: '--yolo',
    initialPromptFlag: '-i',
    resumeFlag: '--continue',
    icon: 'qwen.png',
    alt: 'Qwen Code CLI',
    terminalOnly: true,
    communication: 'acp',
    acpConfig: {
      bridge: 'qwen',
      acpArgs: ['--acp'],
    },
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description:
      'OpenCode CLI that interfaces with models for code generation and edits from the shell.',
    docUrl: 'https://opencode.ai/docs/cli/',
    installCommand: 'npm install -g opencode-ai',
    npmPackage: 'opencode-ai',
    commands: ['opencode'],
    versionArgs: ['--version'],
    cli: 'opencode',
    initialPromptFlag: '',
    useKeystrokeInjection: true,
    icon: 'opencode.png',
    alt: 'OpenCode CLI',
    invertInDark: true,
    terminalOnly: true,
    communication: 'acp',
    acpConfig: {
      bridge: 'opencode',
      acpArgs: ['acp'],
    },
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    description:
      'GitHub Copilot CLI brings Copilot prompts to the terminal for code, shell, and search help.',
    docUrl: 'https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli',
    installCommand: 'npm install -g @github/copilot',
    npmPackage: '@github/copilot',
    commands: ['copilot'],
    versionArgs: ['--version'],
    cli: 'copilot',
    autoApproveFlag: '--allow-all-tools',
    icon: 'gh-copilot.svg',
    alt: 'GitHub Copilot CLI',
    terminalOnly: true,
    communication: 'acp',
    acpConfig: {
      bridge: 'copilot',
      acpArgs: ['--acp', '--stdio'],
    },
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Goose CLI that routes tasks to tools and models for coding workflows.',
    docUrl: 'https://block.github.io/goose/docs/quickstart/',
    installCommand:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    // Block publishes no Windows script beside download_cli.sh.
    windowsInstallCommand: null,
    commands: ['goose'],
    versionArgs: ['--version'],
    cli: 'goose',
    // run subcommand with -s for interactive mode after initial prompt
    defaultArgs: ['run', '-s'],
    initialPromptFlag: '-t',
    icon: 'goose.png',
    alt: 'Goose CLI',
    terminalOnly: true,
    communication: 'acp',
    acpConfig: {
      bridge: 'goose',
      acpArgs: ['acp'],
    },
  },
];
