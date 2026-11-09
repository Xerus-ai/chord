import { createHash, randomBytes } from 'crypto';
import { WorkOS } from '@workos-inc/node';
import { app, shell } from 'electron';
import { log } from '@main/lib/logger';
import { ACCOUNT_CONFIG } from '../config';
import { accountCredentialStore } from './credential-store';
import { copyFreshLoginUrl } from './fresh-login-url';

export interface WorkOSUser {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  orgId: string | null;
}

export interface WorkOSTokens {
  accessToken: string;
  refreshToken: string;
}

interface PendingAuth {
  state: string;
  resolve: (url: URL) => void;
  reject: (error: Error) => void;
}

let pendingAuth: PendingAuth | null = null;

const workos = new WorkOS({ clientId: ACCOUNT_CONFIG.workos.clientId });

export function registerProtocolHandler(): void {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient('chord', process.execPath, ['--']);
  } else {
    app.setAsDefaultProtocolClient('chord');
  }
}

export function handleProtocolUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/auth/callback' || parsed.pathname === '//auth/callback') {
      if (pendingAuth) {
        pendingAuth.resolve(parsed);
        pendingAuth = null;
      }
    }
  } catch (err) {
    log.error('Failed to parse protocol URL:', err);
    if (pendingAuth) {
      pendingAuth.reject(new Error(`Invalid protocol URL: ${url}`));
      pendingAuth = null;
    }
  }
}

async function pollForAuthCode(state: string, timeoutMs: number): Promise<string> {
  const { baseUrl } = ACCOUNT_CONFIG.authServer;
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 1500;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/auth/poll?state=${encodeURIComponent(state)}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = (await res.json()) as { code: string | null };
        if (data.code) return data.code;
      }
    } catch {
      // server not reachable, keep polling
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  throw new Error('WorkOS authentication timed out');
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

export async function signInWithWorkOS(): Promise<{ user: WorkOSUser; tokens: WorkOSTokens }> {
  const { clientId, redirectUri } = ACCOUNT_CONFIG.workos;
  const state = randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = generatePKCE();

  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    provider: 'authkit',
    codeChallenge,
    codeChallengeMethod: 'S256',
  });

  if (process.env.CHORD_FORCE_FRESH_LOGIN) {
    await copyFreshLoginUrl(authorizationUrl);
  } else {
    await shell.openExternal(authorizationUrl);
  }

  const code = await pollForAuthCode(state, ACCOUNT_CONFIG.authServer.authTimeoutMs);

  const authResponse = await workos.userManagement.authenticateWithCode({
    clientId,
    code,
    codeVerifier,
  });

  const { accessToken, refreshToken, user } = authResponse;

  const tokens: WorkOSTokens = {
    accessToken,
    refreshToken: refreshToken ?? '',
  };

  await accountCredentialStore.set(accessToken);

  const workosUser: WorkOSUser = {
    userId: user.id,
    email: user.email,
    name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null,
    avatarUrl: user.profilePictureUrl ?? null,
    orgId: authResponse.organizationId ?? null,
  };

  return { user: workosUser, tokens };
}

export async function refreshWorkOSToken(refreshToken: string): Promise<WorkOSTokens> {
  const { clientId } = ACCOUNT_CONFIG.workos;

  const response = await workos.userManagement.authenticateWithRefreshToken({
    clientId,
    refreshToken,
  });

  const tokens: WorkOSTokens = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? refreshToken,
  };

  await accountCredentialStore.set(response.accessToken);
  return tokens;
}
