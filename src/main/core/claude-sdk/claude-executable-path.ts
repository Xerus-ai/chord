import { createRequire } from 'node:module';
import { unpackedAsarPath } from '@main/utils/unpacked-asar-path';

/**
 * The Claude Code binary every `query()` spawns, for a packaged app.
 *
 * The SDK resolves its platform package (`@anthropic-ai/claude-agent-sdk-
 * <platform>-<arch>`) to a path inside `app.asar` and spawns it, which fails:
 * "native binary … exists but failed to launch". electron-builder unpacks the
 * binary (it detects executables), so the unpacked copy is what to run. Outside
 * an asar this returns undefined and the SDK's own resolution stands.
 */
export function resolvePackagedClaudeExecutable(): string | undefined {
  const require = createRequire(import.meta.url);
  const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const binaryFile = process.platform === 'win32' ? 'claude.exe' : 'claude';
  return unpackedAsarPath(require.resolve(`${packageName}/${binaryFile}`)) ?? undefined;
}
