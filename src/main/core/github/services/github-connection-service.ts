import {
  githubAuthCancelledChannel,
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import type { GitHubConnectResponse, GitHubUser } from '@shared/github';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { encryptedAppSecretsStore } from '@main/core/secrets/encrypted-app-secrets-store';
import { executeOAuthFlow } from '@main/core/shared/oauth-flow';
import { TTLCache } from '@main/core/utils/ttl-cache';
import { KV } from '@main/db/kv';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { extractGhCliToken } from './gh-cli-token';
import { isTokenRejected } from './token-rejection';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthResult = GitHubConnectResponse;

export interface DeviceCodeResult {
  success: boolean;
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
}

/**
 * Manages GitHub authentication tokens regardless of how they were obtained
 * (Chord Account OAuth, Device Flow, PAT, or extracted from gh CLI).
 */
export type TokenSource = 'secure_storage' | 'cli' | null;

export interface GitHubConnectionService {
  getToken(): Promise<string | null>;
  getTokenSource(): Promise<TokenSource>;
  getStatus(): Promise<{
    authenticated: boolean;
    user: GitHubUser | null;
    tokenSource: TokenSource;
  }>;
  isAuthenticated(): Promise<boolean>;
  getCurrentUser(): Promise<GitHubUser | null>;
  getUserInfo(token: string): Promise<GitHubUser>;
  startOAuthFlow(authServerBaseUrl: string): Promise<AuthResult>;
  startDeviceFlowAuth(): Promise<DeviceCodeResult>;
  storeToken(token: string): Promise<void>;
  cancelAuth(): void;
  logout(): Promise<void>;
}

const GITHUB_TOKEN_SECRET_KEY = 'chord-github-token';

interface GitHubKVSchema extends Record<string, unknown> {
  tokenSource: Exclude<TokenSource, null>;
}

const githubKV = new KV<GitHubKVSchema>('github');

const GITHUB_CONFIG = {
  get clientId(): string {
    const id = process.env.GITHUB_OAUTH_CLIENT_ID;
    if (!id) throw new Error('Missing required env var: GITHUB_OAUTH_CLIENT_ID');
    return id;
  },
  scopes: ['repo', 'read:user', 'read:org'] as const,
};

export class GitHubConnectionServiceImpl implements GitHubConnectionService {
  private deviceFlowAbortController: AbortController | null = null;

  private readonly _tokenRecordCache = new TTLCache<{
    token: string | null;
    source: TokenSource;
  }>(5 * 60 * 1000);

  private parseTokenSource(raw: unknown): Exclude<TokenSource, null> | null {
    return raw === 'cli' || raw === 'secure_storage' ? raw : null;
  }

  private async getStoredTokenSource(): Promise<Exclude<TokenSource, null> | null> {
    try {
      return this.parseTokenSource(await githubKV.get('tokenSource'));
    } catch {
      return null;
    }
  }

  private async setStoredTokenSource(source: Exclude<TokenSource, null>): Promise<void> {
    await githubKV.set('tokenSource', source);
  }

  private async clearStoredTokenSource(): Promise<void> {
    await githubKV.del('tokenSource');
  }

  private async getStoredTokenRecord(): Promise<{
    token: string | null;
    source: Exclude<TokenSource, null> | null;
  }> {
    try {
      const token = (await encryptedAppSecretsStore.getSecret(GITHUB_TOKEN_SECRET_KEY)) ?? null;
      const source = await this.getStoredTokenSource();
      return { token, source };
    } catch {
      return { token: null, source: null };
    }
  }

  private async clearStoredToken(): Promise<void> {
    this._invalidateTokenCache();
    await Promise.all([
      encryptedAppSecretsStore.deleteSecret(GITHUB_TOKEN_SECRET_KEY),
      this.clearStoredTokenSource(),
    ]);
  }

  private _invalidateTokenCache(): void {
    this._tokenRecordCache.invalidate();
  }

  private resolveTokenRecord(): Promise<{ token: string | null; source: TokenSource }> {
    return this._tokenRecordCache.get(() => this._doResolveTokenRecord());
  }

  private async _doResolveTokenRecord(): Promise<{ token: string | null; source: TokenSource }> {
    const { token: storedToken, source } = await this.getStoredTokenRecord();
    const ctx = new LocalExecutionContext();

    if (storedToken && source === 'cli') {
      const cliToken = await extractGhCliToken(ctx);
      if (!cliToken) {
        try {
          await this.clearStoredToken();
        } catch (error) {
          log.warn('Failed to clear stale CLI token from secure storage:', error);
        }
        return { token: null, source: null };
      }
      if (cliToken !== storedToken) {
        try {
          await this.storeToken(cliToken, 'cli');
        } catch (error) {
          log.warn('Failed to sync refreshed CLI token to secure storage:', error);
        }
        return { token: cliToken, source: 'cli' };
      }
      return { token: storedToken, source: 'cli' };
    }

    if (storedToken) {
      return { token: storedToken, source: source ?? 'secure_storage' };
    }

    const cliToken = await extractGhCliToken(ctx);
    if (!cliToken) return { token: null, source: null };

    try {
      await this.storeToken(cliToken, 'cli');
    } catch (error) {
      log.warn('Failed to cache CLI token in secure storage:', error);
    }
    return { token: cliToken, source: 'cli' };
  }

  async getToken(): Promise<string | null> {
    const { token } = await this.resolveTokenRecord();
    return token;
  }

  async getTokenSource(): Promise<TokenSource> {
    const { token, source } = await this.resolveTokenRecord();
    if (!token) return null;
    return source ?? 'secure_storage';
  }

  async getStatus(): Promise<{
    authenticated: boolean;
    user: GitHubUser | null;
    tokenSource: TokenSource;
  }> {
    const { token, source } = await this.resolveTokenRecord();
    if (!token) {
      return { authenticated: false, user: null, tokenSource: null };
    }

    try {
      const user = await this.getUserInfo(token);
      return {
        authenticated: true,
        user,
        tokenSource: source ?? 'secure_storage',
      };
    } catch (error) {
      // GitHub rejecting the token is a real "not connected" answer. Anything
      // else — offline, DNS, 5xx — leaves the status genuinely unknown, and
      // reporting it as signed out told users to reconnect an account that was
      // never disconnected.
      if (isTokenRejected(error)) {
        return { authenticated: false, user: null, tokenSource: null };
      }
      throw error;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }

  async getCurrentUser(): Promise<GitHubUser | null> {
    const token = await this.getToken();
    if (!token) return null;
    return this.getUserInfo(token);
  }

  /** Throws when GitHub cannot be reached or rejects the token — callers that
      can live without a display name decide that explicitly. */
  async getUserInfo(token: string): Promise<GitHubUser> {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.rest.users.getAuthenticated();
    return {
      id: data.id,
      login: data.login,
      name: data.name ?? '',
      email: data.email ?? '',
      avatar_url: data.avatar_url,
    };
  }

  async startOAuthFlow(authServerBaseUrl: string): Promise<AuthResult> {
    try {
      const raw = await executeOAuthFlow({
        authorizeUrl: `${authServerBaseUrl}/auth/github`,
        exchangeUrl: `${authServerBaseUrl}/api/v1/auth/electron/exchange`,
        successRedirectUrl: `${authServerBaseUrl}/auth/success`,
        errorRedirectUrl: `${authServerBaseUrl}/auth/error`,
      });

      const accessToken = raw.accessToken as string;
      if (!accessToken) {
        return { success: false, error: 'No access token in response' };
      }

      await this.storeToken(accessToken);
      // The token is already persisted at this point, so a failed profile
      // lookup must not report the connection as failed — the account is
      // connected, only its display name is missing.
      const user = await this.getUserInfo(accessToken).catch((error: unknown) => {
        log.warn('GitHub profile lookup failed after OAuth; token kept:', error);
        return undefined;
      });
      return { success: true, token: accessToken, user };
    } catch (error) {
      log.warn('GitHub OAuth flow failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      };
    }
  }

  async startDeviceFlowAuth(): Promise<DeviceCodeResult> {
    // Loaded before the abort controller exists, so a cancel always finds the
    // listener below attached.
    const { createOAuthDeviceAuth } = await import('@octokit/auth-oauth-device');
    this.deviceFlowAbortController = new AbortController();
    const { signal } = this.deviceFlowAbortController;

    try {
      const auth = createOAuthDeviceAuth({
        clientId: GITHUB_CONFIG.clientId,
        scopes: [...GITHUB_CONFIG.scopes],
        onVerification: (verification) => {
          events.emit(githubAuthDeviceCodeChannel, {
            userCode: verification.user_code,
            verificationUri: verification.verification_uri,
            expiresIn: verification.expires_in,
            interval: verification.interval,
          });
        },
      });

      const authPromise = auth({ type: 'oauth' });

      const cancelPromise = new Promise<never>((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('Auth cancelled'));
        });
      });

      const result = await Promise.race([authPromise, cancelPromise]);
      const token = result.token;

      await this.storeToken(token);

      // Same as the OAuth path: the token is stored, so a profile lookup
      // failure downgrades to "connected, name unknown" rather than failing
      // an authentication that actually succeeded.
      const user = await this.getUserInfo(token).catch((error: unknown) => {
        log.warn('GitHub profile lookup failed after device flow; token kept:', error);
        return null;
      });

      // Emitted unconditionally: both renderer listeners complete the device
      // flow only on this event, so gating it on the profile lookup left the
      // modal counting down to "code expired" on a connection that succeeded.
      events.emit(githubAuthSuccessChannel, { user });

      return {
        success: true,
        device_code: undefined,
        user_code: undefined,
        verification_uri: undefined,
      };
    } catch (error) {
      if (signal.aborted) {
        events.emit(githubAuthCancelledChannel, undefined);
        return { success: false, error: 'Auth cancelled' };
      }

      const message = error instanceof Error ? error.message : String(error);
      events.emit(githubAuthErrorChannel, { error: 'device_flow_error', message });
      return { success: false, error: message };
    } finally {
      this.deviceFlowAbortController = null;
    }
  }

  async storeToken(
    token: string,
    source: Exclude<TokenSource, null> = 'secure_storage'
  ): Promise<void> {
    this._invalidateTokenCache();
    await encryptedAppSecretsStore.setSecret(GITHUB_TOKEN_SECRET_KEY, token);
    await this.setStoredTokenSource(source);
  }

  cancelAuth(): void {
    if (this.deviceFlowAbortController) {
      this.deviceFlowAbortController.abort();
      this.deviceFlowAbortController = null;
    }
  }

  async logout(): Promise<void> {
    await this.clearStoredToken();
  }
}

export const githubConnectionService = new GitHubConnectionServiceImpl();
