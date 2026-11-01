/**
 * npm picks native binaries by its `os` / `cpu` config, which a user's npmrc
 * can pin to another platform (an `os=linux` line on Windows installs Linux
 * binaries that cannot run). Anything Chord installs or runs through npm is
 * for the machine it runs on, so these pin npm to that machine over any
 * npmrc: npm ranks command-line flags, then `npm_config_*` variables, above
 * every config file.
 */
const HOST_NPM_PLATFORM: Record<string, string> = { os: process.platform, cpu: process.arch };

/** For an npm/npx argv this process builds. */
export const HOST_NPM_PLATFORM_ARGS = Object.entries(HOST_NPM_PLATFORM).map(
  ([key, value]) => `--${key}=${value}`
);

/**
 * For an npm command inside a shell line. npm reads `npm_config_*` in any
 * case and npm/pnpm export config to their children (`NPM_CONFIG_OS`), so
 * every case variant is replaced — on Windows the child would otherwise get
 * whichever duplicate comes first.
 */
export function withHostNpmPlatform(env: NodeJS.ProcessEnv): Record<string, string> {
  const pinned = Object.keys(HOST_NPM_PLATFORM).map((key) => `npm_config_${key}`);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !pinned.includes(key.toLowerCase())) result[key] = value;
  }
  for (const [key, value] of Object.entries(HOST_NPM_PLATFORM)) result[`npm_config_${key}`] = value;
  return result;
}

/**
 * The same pin for a command run in a remote POSIX shell, where the host is
 * whatever the remote `node` reports. Hosts without node have no npm to pin.
 */
export const HOST_NPM_PLATFORM_SHELL_PREFIX =
  'unset NPM_CONFIG_OS NPM_CONFIG_CPU; ' +
  'if command -v node >/dev/null 2>&1; then ' +
  'export npm_config_os="$(node -p process.platform)" npm_config_cpu="$(node -p process.arch)"; ' +
  'fi; ';
