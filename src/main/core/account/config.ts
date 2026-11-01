import { requireEnv } from './require-env';

const AUTH_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export const ACCOUNT_CONFIG = {
  authServer: {
    baseUrl: requireEnv('CHORD_AUTH_SERVER_URL'),
    authTimeoutMs: Number(process.env.CHORD_AUTH_TIMEOUT_MS || AUTH_DEFAULT_TIMEOUT_MS),
  },
  workos: {
    clientId: requireEnv('WORKOS_CLIENT_ID'),
    redirectUri: requireEnv('WORKOS_REDIRECT_URI'),
    authKitUrl: requireEnv('WORKOS_AUTHKIT_URL'),
  },
};
