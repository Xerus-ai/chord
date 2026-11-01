import { accountStateChangedChannel, type AuthState } from '@shared/events/accountEvents';
import { KV } from '@main/db/kv';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { ACCOUNT_CONFIG } from '../config';
import { accountCredentialStore } from './credential-store';
import { refreshWorkOSToken, signInWithWorkOS, type WorkOSTokens } from './workos-auth-service';

export interface AccountUser {
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
  orgId: string | null;
}

export interface CachedProfile {
  hasAccount: boolean;
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
  orgId: string | null;
  lastValidated: string;
}

export interface SignInResult {
  user: AccountUser;
}

export interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
  authState: AuthState;
}

interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
  refreshToken: string;
}

const accountKV = new KV<AccountKVSchema>('account');

function tokenExpiresWithin(token: string, marginSeconds: number): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString());
    if (typeof payload.exp !== 'number') return true;
    return payload.exp - marginSeconds <= Date.now() / 1000;
  } catch {
    return true;
  }
}

export class ChordAccountService {
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  private initialLoadPromise: Promise<void> | null = null;
  // Sticky "cloud calls cannot succeed until the user signs in again" flag —
  // the one fact getAccessToken used to know but only whisper into the log.
  private reauthRequired = false;
  private lastEmittedAuthState: AuthState | null = null;

  /**
   * `reauth_required` outranks `signed_in`: credentials exist but are known
   * dead. `signed_out` is the absence of credentials entirely — callers must
   * only trust this after loadSessionToken has settled.
   */
  getAuthState(): AuthState {
    if (this.sessionToken === null && this.refreshToken === null) return 'signed_out';
    return this.reauthRequired ? 'reauth_required' : 'signed_in';
  }

  // Every credential mutation funnels through a state check so transitions
  // are broadcast exactly once — not per failing cloud call per tick.
  private emitAuthStateIfChanged(): void {
    const state = this.getAuthState();
    if (state === this.lastEmittedAuthState) return;
    this.lastEmittedAuthState = state;
    log.info('[account] auth state changed', { authState: state });
    events.emit(accountStateChangedChannel, { authState: state });
  }

  private markReauthRequired(): void {
    this.reauthRequired = true;
    this.emitAuthStateIfChanged();
  }

  /**
   * The signed-in account's user id from the last getSession() read, without
   * touching the store — for synchronous callers (the sync queue's enqueue
   * gate) that run after a session read has happened. Null until then, or
   * when no account is signed in.
   */
  getCachedUserId(): string | null {
    if (!this.cachedProfile?.hasAccount || this.sessionToken === null) return null;
    return this.cachedProfile.userId;
  }

  async getSession(): Promise<SessionState> {
    // Derive isSignedIn only AFTER the boot-time credential-store read has
    // settled. The load is kicked off fire-and-forget at startup; without this
    // await, a getSession() that lands first sees sessionToken === null and
    // reports an already-signed-in user as signed out — stranding them on the
    // sign-in screen (the renderer asks exactly once, no retry).
    await this.loadSessionToken();
    this.cachedProfile = await accountKV.get('profile');
    const hasAccount = this.cachedProfile?.hasAccount === true;
    const isSignedIn = hasAccount && this.sessionToken !== null;
    return {
      user:
        isSignedIn && this.cachedProfile
          ? {
              userId: this.cachedProfile.userId,
              username: this.cachedProfile.username,
              avatarUrl: this.cachedProfile.avatarUrl,
              email: this.cachedProfile.email,
              orgId: this.cachedProfile.orgId,
            }
          : null,
      isSignedIn,
      hasAccount,
      authState: this.getAuthState(),
    };
  }

  // Memoized so the startup kick and the first getSession/getAccessToken share
  // ONE credential-store read instead of racing. A failed load clears the memo
  // so a later call retries rather than caching the rejection forever.
  async loadSessionToken(): Promise<void> {
    if (!this.initialLoadPromise) {
      this.initialLoadPromise = this.readStoredCredentials().catch((e: unknown) => {
        this.initialLoadPromise = null;
        throw e;
      });
    }
    return this.initialLoadPromise;
  }

  private async readStoredCredentials(): Promise<void> {
    // Normalize to null: getSession derives isSignedIn from `sessionToken !==
    // null`, and an absent token that came back undefined would read as signed
    // in (undefined !== null).
    this.sessionToken = (await accountCredentialStore.get()) ?? null;
    const stored = await accountKV.get('refreshToken');
    this.refreshToken = stored ?? null;
  }

  async getAccessToken(): Promise<string | null> {
    await this.loadSessionToken();
    if (!this.sessionToken) return null;
    if (tokenExpiresWithin(this.sessionToken, 30) && this.refreshToken) {
      await this.refreshSessionToken();
    }
    // A short overrun is tolerated (clock drift, server grace), but a token
    // dead for minutes means refresh is failing too — handing it out just
    // makes every cloud call 401 with no visible cause. Null tells callers
    // the truth: this session needs a re-sign-in.
    if (tokenExpiresWithin(this.sessionToken, -300)) {
      log.warn('[account] access token long-expired and refresh failed; re-sign-in required');
      this.markReauthRequired();
      return null;
    }
    return this.sessionToken;
  }

  async signIn(): Promise<SignInResult> {
    const { user: workosUser, tokens } = await signInWithWorkOS();

    this.sessionToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;

    await accountKV.set('refreshToken', tokens.refreshToken);

    // An AuthKit sign-in without an org selection carries no organizationId,
    // so a re-sign-in must not null out an orgId this install already
    // resolved — that exact overwrite parked the owner's sync queue behind a
    // null org for weeks (NEW-6). Keep the previous value for the same user;
    // a different user never inherits another account's org.
    const previous = await accountKV.get('profile');
    const preservedOrgId = previous?.userId === workosUser.userId ? previous.orgId : null;

    const profile: CachedProfile = {
      hasAccount: true,
      userId: workosUser.userId,
      username: workosUser.name || workosUser.email.split('@')[0]!,
      avatarUrl: workosUser.avatarUrl || '',
      email: workosUser.email,
      orgId: workosUser.orgId ?? preservedOrgId,
      lastValidated: new Date().toISOString(),
    };
    this.cachedProfile = profile;
    await accountKV.set('profile', profile);

    await this.syncProfileToCloud(profile);

    const user: AccountUser = {
      userId: profile.userId,
      username: profile.username,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      orgId: profile.orgId,
    };

    this.reauthRequired = false;
    this.emitAuthStateIfChanged();

    return { user };
  }

  /**
   * Switches the active workspace to an org the user now belongs to (the
   * accept-invite flow) and re-syncs. Mirrors sign-in's orgId handling:
   * persist the new orgId, then sync-profile with it. The server honors the
   * body org_id because a membership row exists for this user in that org, so
   * it resolves the caller into the accepted workspace instead of the oldest
   * one. A no-op when the org is already active.
   */
  async setActiveOrg(orgId: string): Promise<void> {
    const profile = this.cachedProfile ?? (await accountKV.get('profile'));
    if (!profile || !profile.hasAccount) {
      log.warn('[account] setActiveOrg called without a signed-in profile');
      return;
    }
    if (profile.orgId === orgId) return;

    profile.orgId = orgId;
    this.cachedProfile = profile;
    await accountKV.set('profile', profile);

    await this.syncProfileToCloud(profile);
    this.emitAuthStateIfChanged();
  }

  private async syncProfileToCloud(profile: CachedProfile): Promise<void> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const res = await fetch(`${baseUrl}/auth/sync-profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.sessionToken}`,
        },
        body: JSON.stringify({
          name: profile.username,
          avatar_url: profile.avatarUrl,
          org_id: profile.orgId,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const data = (await res.json()) as { org_id?: string | null };
        if (data.org_id && !profile.orgId) {
          profile.orgId = data.org_id;
          this.cachedProfile = profile;
          await accountKV.set('profile', profile);
        }
      } else {
        log.warn('[account] sign-in profile sync rejected', {
          status: res.status,
          body: (await res.text()).slice(0, 300),
        });
      }
    } catch (error) {
      // Non-blocking — resolveOrgId retries on every sync-queue cycle, but
      // never silently: this failure is exactly where a wedged org
      // resolution starts (NEW-6).
      log.warn('[account] sign-in profile sync failed', { error: String(error) });
    }
  }

  async signOut(): Promise<void> {
    this.sessionToken = null;
    this.refreshToken = null;
    this.reauthRequired = false;
    await accountCredentialStore.clear();
    await accountKV.set('refreshToken', '');
    if (this.cachedProfile) {
      this.cachedProfile.hasAccount = false;
      await accountKV.set('profile', this.cachedProfile);
    }
    this.emitAuthStateIfChanged();
  }

  async checkServerHealth(): Promise<boolean> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async validateSession(): Promise<boolean> {
    if (!this.sessionToken) return false;

    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(`${baseUrl}/api/auth/get-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.sessionToken}` },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        if (this.refreshToken) {
          return await this.attemptTokenRefresh();
        }
        await this.clearSession();
        return false;
      }

      if (this.cachedProfile) {
        this.cachedProfile.lastValidated = new Date().toISOString();
        await accountKV.set('profile', this.cachedProfile);
      }
      return true;
    } catch {
      return this.sessionToken !== null;
    }
  }

  private async refreshSessionToken(): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    this.refreshPromise = (async () => {
      try {
        const tokens = await refreshWorkOSToken(this.refreshToken!);
        this.sessionToken = tokens.accessToken;
        this.refreshToken = tokens.refreshToken;
        await accountKV.set('refreshToken', tokens.refreshToken);
        this.reauthRequired = false;
        this.emitAuthStateIfChanged();
      } catch (e) {
        // Keep the existing token — it may still be accepted by the server
        // despite expiry (clock drift, grace periods). Only clearSession on
        // explicit 401 from the server, not on refresh failure. But never
        // silently: an invalidated refresh token (they're single-use) means
        // every future cloud call fails until the user signs in again —
        // `invalid_grant` is WorkOS saying exactly that, so it flips the
        // authState the UI renders rather than staying a log line.
        log.warn('[account] session token refresh failed', { error: String(e) });
        if (String(e).includes('invalid_grant')) {
          this.markReauthRequired();
        }
      }
    })();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async attemptTokenRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    try {
      const tokens: WorkOSTokens = await refreshWorkOSToken(this.refreshToken);
      this.sessionToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      await accountKV.set('refreshToken', tokens.refreshToken);
      this.reauthRequired = false;
      this.emitAuthStateIfChanged();
      return true;
    } catch {
      await this.clearSession();
      return false;
    }
  }

  private async clearSession(): Promise<void> {
    this.sessionToken = null;
    this.refreshToken = null;
    this.reauthRequired = false;
    await accountCredentialStore.clear();
    await accountKV.set('refreshToken', '');
    if (this.cachedProfile) {
      this.cachedProfile.hasAccount = false;
      await accountKV.set('profile', this.cachedProfile);
    }
    this.emitAuthStateIfChanged();
  }
}

export const chordAccountService = new ChordAccountService();
