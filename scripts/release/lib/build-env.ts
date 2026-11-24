/**
 * The variables a release build bakes into the packaged app (devstation-pqub). A packaged app
 * reads no .env, and its main process refuses to start without the sign-in and cloud
 * addresses (src/main/core/account/require-env.ts); the renderer's VITE_* addresses are
 * compiled in by vite. release.yml's build job sets them and CHORD_RELEASE_BUILD=1;
 * electron.vite.config.ts bakes what this returns, and src/main/app/packaged-env.ts puts it
 * in process.env at start.
 */
export const PACKAGED_ENV_NAMES = [
  'WORKOS_CLIENT_ID',
  'WORKOS_REDIRECT_URI',
  'WORKOS_AUTHKIT_URL',
  'GITHUB_OAUTH_CLIENT_ID',
  'CHORD_AUTH_SERVER_URL',
  'CHORD_CLOUD_API_URL',
  'CHORD_DOCS_URL',
  'CHORD_ISSUES_URL',
  'CHORD_RELEASES_URL',
  'CHORD_TERMS_URL',
  'CHORD_PRIVACY_URL',
  'VITE_CLOUD_API_URL',
  'VITE_CLOUD_WS_URL',
  'VITE_COLLAB_WS_URL',
] as const;

/**
 * Outside a release build: nothing (a development build reads .env at run time). In a release
 * build: every variable, each address over TLS; throws naming what is missing or not TLS.
 */
export function readPackagedEnv(env: Record<string, string | undefined>): Record<string, string> {
  if (env.CHORD_RELEASE_BUILD !== '1') return {};
  const missing = PACKAGED_ENV_NAMES.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`a release build needs ${missing.join(', ')} set`);
  }
  const insecure = PACKAGED_ENV_NAMES.filter(
    (name) => /_(URL|URI)$/.test(name) && !/^(https|wss):\/\//.test(env[name] ?? '')
  );
  if (insecure.length > 0) {
    const list = insecure.map((name) => `${name}=${env[name]}`).join(', ');
    throw new Error(`a release build ships only https:// and wss:// addresses: ${list}`);
  }
  return Object.fromEntries(PACKAGED_ENV_NAMES.map((name) => [name, env[name] as string]));
}
