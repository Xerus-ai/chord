import fs from 'node:fs';

function resolveGitBin(): string {
  const candidates = [
    (process.env.GIT_PATH || '').trim(),
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/usr/bin/git',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return 'git';
}

/** Resolved path to the `git` binary — use for all git exec calls. */
export const GIT_EXECUTABLE = resolveGitBin();

function shouldUseHttpRemote(args: string[]): boolean {
  const subcommand = args[0];
  if (!subcommand) return false;
  if (['clone', 'fetch', 'pull', 'push', 'ls-remote'].includes(subcommand)) return true;
  return subcommand === 'remote' && args[1] === 'show';
}

/**
 * The environment that gives the git command `args` the user's GitHub token.
 * The config travels as `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`
 * (git 2.31+) rather than `-c` arguments, so the token never appears in the
 * command line — which a failed command's error repeats, and the app shows.
 */
export async function buildGitHubAuthEnv(
  args: string[],
  getToken: () => Promise<string | null>
): Promise<Record<string, string>> {
  const rawToken = await getToken();
  if (!rawToken) return {};

  const token = Buffer.from(`x-access-token:${rawToken}`).toString('base64');
  const entries: Array<[string, string]> = [
    ['http.https://github.com/.extraHeader', `Authorization: Basic ${token}`],
  ];

  if (shouldUseHttpRemote(args)) {
    entries.push(
      ['url.https://github.com/.insteadOf', 'git@github.com:'],
      ['url.https://github.com/.insteadOf', 'ssh://git@github.com:'],
      ['url.https://github.com/.insteadOf', 'ssh://git@github.com/']
    );
  }

  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(entries.length) };
  entries.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
}
