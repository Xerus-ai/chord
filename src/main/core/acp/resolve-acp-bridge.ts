import { execFileSync } from 'node:child_process';
import { log } from '@main/lib/logger';
import { HOST_NPM_PLATFORM_ARGS } from '@main/utils/npm-host-platform';

/**
 * The command that runs an ACP agent's bridge: its own binary when it takes
 * no npx package, else a globally installed copy of the package, else npx.
 */
export async function resolveAcpBridge(acpConfig: {
  bridge: string;
  acpArgs?: string[];
  usesNpx?: boolean;
}): Promise<{ command: string; args: string[] }> {
  if (!acpConfig.usesNpx) {
    return { command: acpConfig.bridge, args: [...(acpConfig.acpArgs ?? [])] };
  }

  const binaryName = acpConfig.bridge.replace(/@[^/]+\//, '').replace(/@[\d].*$/, '');

  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const lines = execFileSync(cmd, [binaryName], { encoding: 'utf-8', timeout: 5000 })
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // On Windows, `where` returns both the extensionless Unix shim and the .cmd wrapper.
    // The Unix shim (#!/bin/sh) exits with code 1 on Windows — pick the .cmd file.
    let resolved = lines[0];
    if (process.platform === 'win32') {
      resolved = lines.find((l) => l.endsWith('.cmd')) ?? lines[0];
    }

    if (resolved) {
      log.info('resolveAcpBridge: using global binary', { binary: resolved });
      return { command: resolved, args: [...(acpConfig.acpArgs ?? [])] };
    }
  } catch {
    // not installed globally
  }

  log.info('resolveAcpBridge: falling back to npx --prefer-offline', { bridge: acpConfig.bridge });
  return {
    command: 'npx',
    args: [
      '--prefer-offline',
      '--yes',
      ...HOST_NPM_PLATFORM_ARGS,
      acpConfig.bridge,
      ...(acpConfig.acpArgs ?? []),
    ],
  };
}
