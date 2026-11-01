// Regenerates src/main/core/codex-app-server/protocol/ from the installed
// Codex CLI: `codex app-server generate-ts --experimental` emits the whole
// protocol (~850 files); only the types the transport imports, and what they
// import in turn, are vendored. Run after upgrading Codex:
//   pnpm run codex:protocol
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY_TYPES = [
  'InitializeParams',
  'InitializeResponse',
  'v2/ThreadStartParams',
  'v2/ThreadStartResponse',
  'v2/ThreadResumeParams',
  'v2/ThreadResumeResponse',
  // Session import (plan §Phase 3 slice 5): a lane's outside threads and their history.
  'v2/ThreadListParams',
  'v2/ThreadListResponse',
  'v2/ThreadReadParams',
  'v2/ThreadReadResponse',
  'v2/ThreadTurnsListParams',
  'v2/ThreadTurnsListResponse',
  'v2/ThreadItemsListParams',
  'v2/ThreadItemsListResponse',
  // History (plan §Phase 5): Reset and Fork cut a thread at a turn.
  'v2/ThreadForkParams',
  'v2/ThreadForkResponse',
  'v2/TurnStartParams',
  'v2/TurnStartResponse',
  'v2/TurnInterruptParams',
  'v2/ModelListParams',
  'v2/ModelListResponse',
  'v2/GetAccountRateLimitsResponse',
  // Git AI (`git-ai-agent-status.ts`): whether Codex is signed in.
  'v2/GetAccountParams',
  'v2/GetAccountResponse',
  'v2/ItemStartedNotification',
  'v2/ItemCompletedNotification',
  'v2/AgentMessageDeltaNotification',
  'v2/ReasoningSummaryTextDeltaNotification',
  'v2/ReasoningTextDeltaNotification',
  'v2/TurnCompletedNotification',
  'v2/TurnPlanUpdatedNotification',
  'v2/ThreadTokenUsageUpdatedNotification',
  'v2/AccountRateLimitsUpdatedNotification',
  'v2/ErrorNotification',
  'v2/CommandExecutionRequestApprovalParams',
  'v2/CommandExecutionRequestApprovalResponse',
  'v2/FileChangeRequestApprovalParams',
  'v2/FileChangeRequestApprovalResponse',
  'v2/PermissionsRequestApprovalParams',
  'v2/PermissionsRequestApprovalResponse',
  'v2/McpServerElicitationRequestParams',
  'v2/McpServerElicitationRequestResponse',
  'v2/ToolRequestUserInputParams',
  'v2/ToolRequestUserInputResponse',
  'v2/ExperimentalFeatureListParams',
  'v2/ExperimentalFeatureListResponse',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src/main/core/codex-app-server/protocol');
const generated = mkdtempSync(join(tmpdir(), 'codex-protocol-'));

execFileSync('codex', ['app-server', 'generate-ts', '--experimental', '--out', generated], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const used = new Set();
function collect(type) {
  if (used.has(type)) return;
  used.add(type);
  const source = readFileSync(join(generated, `${type}.ts`), 'utf8');
  for (const match of source.matchAll(/from "(\.[^"]+)"/g)) {
    collect(posix.normalize(posix.join(posix.dirname(type), match[1])));
  }
}
ENTRY_TYPES.forEach(collect);

rmSync(target, { recursive: true, force: true });
for (const type of used) {
  const destination = join(target, `${type}.ts`);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(generated, `${type}.ts`), destination);
}
rmSync(generated, { recursive: true, force: true });
console.log(`codex protocol: vendored ${used.size} generated files into ${target}`);
