import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';

export type CodexNotifyCommandOptions = {
  platform?: NodeJS.Platform;
  writeFile?: (path: string, content: string) => void;
  mkdir?: (path: string) => void;
  scriptPath?: string;
};

const ensuredWindowsCodexNotifyScriptPaths = new Set<string>();

export function makeClaudeHookCommand(eventType: string): string {
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Chord-Token: $CHORD_HOOK_TOKEN" ' +
    '-H "X-Chord-Pty-Id: $CHORD_PTY_ID" ' +
    `-H "X-Chord-Event-Type: ${eventType}" ` +
    '-d @- ' +
    '"http://127.0.0.1:$CHORD_HOOK_PORT/hook" || true'
  );
}

function makePosixCodexNotifyCommand(): string[] {
  return [
    'bash',
    '-c',
    'curl -sf -X POST ' +
      "-H 'Content-Type: application/json' " +
      '-H "X-Chord-Token: $CHORD_HOOK_TOKEN" ' +
      '-H "X-Chord-Pty-Id: $CHORD_PTY_ID" ' +
      '-H "X-Chord-Event-Type: notification" ' +
      '-d "$1" ' +
      '"http://127.0.0.1:$CHORD_HOOK_PORT/hook" || true',
    '_',
  ];
}

function windowsCodexNotifyScript(): string {
  return [
    'param([string]$payload)',
    'try {',
    '  Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:CHORD_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Chord-Token' = $env:CHORD_HOOK_TOKEN; " +
      "'X-Chord-Pty-Id' = $env:CHORD_PTY_ID; " +
      "'X-Chord-Event-Type' = 'notification' " +
      '} -Body $payload | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
  ].join('\n');
}

function ensureWindowsCodexNotifyScript(options: CodexNotifyCommandOptions): string {
  const platform = options.platform ?? process.platform;
  const scriptPath = options.scriptPath ?? join(tmpdir(), 'chord-codex-notify.ps1');
  if (ensuredWindowsCodexNotifyScriptPaths.has(scriptPath)) {
    return scriptPath;
  }

  const scriptDir = platform === 'win32' ? win32.dirname(scriptPath) : dirname(scriptPath);
  const mkdir = options.mkdir ?? ((path: string) => mkdirSync(path, { recursive: true }));
  const writeFile = options.writeFile ?? writeFileSync;

  // A notify pointing at a script that was never written fires nothing, so a
  // failed write fails the launch rather than passing that command on.
  mkdir(scriptDir);
  writeFile(scriptPath, windowsCodexNotifyScript());
  ensuredWindowsCodexNotifyScriptPaths.add(scriptPath);
  return scriptPath;
}

function makeWindowsCodexNotifyCommand(options: CodexNotifyCommandOptions): string[] {
  return ['powershell.exe', '-NoProfile', '-File', ensureWindowsCodexNotifyScript(options)];
}

export function makeCodexNotifyCommand(options: CodexNotifyCommandOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  return platform === 'win32'
    ? makeWindowsCodexNotifyCommand(options)
    : makePosixCodexNotifyCommand();
}
