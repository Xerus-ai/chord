import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChordAccountService } from './chord-account-service';

const mockCredGet = vi.fn();
const mockCredSet = vi.fn();
const mockCredClear = vi.fn();
vi.mock('./credential-store', () => ({
  accountCredentialStore: {
    get: (...args: unknown[]) => mockCredGet(...args),
    set: (...args: unknown[]) => mockCredSet(...args),
    clear: (...args: unknown[]) => mockCredClear(...args),
  },
}));

const mockKvGet = vi.fn();
const mockKvSet = vi.fn();
vi.mock('@main/db/kv', () => ({
  KV: class {
    get(...args: unknown[]) {
      return mockKvGet(...args);
    }
    set(...args: unknown[]) {
      return mockKvSet(...args);
    }
  },
}));

const mockSignInWithWorkOS = vi.fn();
const mockRefreshWorkOSToken = vi.fn();
vi.mock('./workos-auth-service', () => ({
  signInWithWorkOS: (...args: unknown[]) => mockSignInWithWorkOS(...args),
  refreshWorkOSToken: (...args: unknown[]) => mockRefreshWorkOSToken(...args),
}));

vi.mock('../config', () => ({
  ACCOUNT_CONFIG: {
    authServer: { baseUrl: 'https://auth.test.example.com', authTimeoutMs: 5000 },
    workos: {
      clientId: 'client_test',
      redirectUri: 'chord://auth/callback',
      authKitUrl: 'https://test.authkit.app',
    },
  },
}));

const mockEventEmit = vi.fn();
vi.mock('@main/lib/events', () => ({
  events: {
    emit: (...args: unknown[]) => mockEventEmit(...args),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** A structurally valid JWT whose exp is `offsetSeconds` from now. */
function tokenWithExp(offsetSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offsetSeconds })
  ).toString('base64url');
  return `header.${payload}.sig`;
}

describe('ChordAccountService', () => {
  let service: ChordAccountService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue(undefined);
    service = new ChordAccountService();
  });

  describe('getSession()', () => {
    it('returns no account when profile cache is empty', async () => {
      const session = await service.getSession();
      expect(session).toEqual({
        user: null,
        isSignedIn: false,
        hasAccount: false,
        authState: 'signed_out',
      });
    });

    it('returns hasAccount true but not signed in when profile exists but no token', async () => {
      mockKvGet.mockResolvedValue({
        hasAccount: true,
        userId: 'u1',
        username: 'test',
        avatarUrl: '',
        email: 'test@test.com',
        orgId: null,
        lastValidated: '2026-01-01',
      });
      const session = await service.getSession();
      expect(session.hasAccount).toBe(true);
      expect(session.isSignedIn).toBe(false);
      expect(session.user).toBeNull();
    });
  });

  describe('loadSessionToken()', () => {
    it('loads token from credential store', async () => {
      mockCredGet.mockResolvedValue('token-123');
      await service.loadSessionToken();
      expect(mockCredGet).toHaveBeenCalled();
    });
  });

  describe('signIn()', () => {
    it('calls signInWithWorkOS and stores session', async () => {
      mockSignInWithWorkOS.mockResolvedValue({
        user: {
          userId: 'user_01ABC',
          email: 'test@example.com',
          name: 'Test User',
          avatarUrl: 'https://img.com/a',
          orgId: 'org_01XYZ',
        },
        tokens: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-456',
        },
      });

      const result = await service.signIn();

      expect(mockSignInWithWorkOS).toHaveBeenCalled();
      expect(mockKvSet).toHaveBeenCalledWith('refreshToken', 'refresh-token-456');
      expect(mockKvSet).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({ hasAccount: true, userId: 'user_01ABC' })
      );
      expect(result.user.email).toBe('test@example.com');
    });
  });

  describe('signOut()', () => {
    it('clears session token and marks hasAccount false', async () => {
      mockSignInWithWorkOS.mockResolvedValue({
        user: { userId: 'u1', email: 'a@b.com', name: 'Test', avatarUrl: '', orgId: null },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      });
      await service.signIn();
      vi.clearAllMocks();
      mockKvSet.mockResolvedValue(undefined);

      await service.signOut();

      expect(mockCredClear).toHaveBeenCalled();
      expect(mockKvSet).toHaveBeenCalledWith('refreshToken', '');
    });
  });

  describe('validateSession()', () => {
    it('returns false when no session token', async () => {
      const result = await service.validateSession();
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('attempts token refresh on 401', async () => {
      mockSignInWithWorkOS.mockResolvedValue({
        user: { userId: 'u1', email: 'a@b.com', name: 'Test', avatarUrl: '', orgId: null },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      });
      await service.signIn();
      vi.clearAllMocks();
      mockKvSet.mockResolvedValue(undefined);

      mockFetch.mockResolvedValue({ ok: false, status: 401 });
      mockRefreshWorkOSToken.mockResolvedValue({
        accessToken: 'new-at',
        refreshToken: 'new-rt',
      });

      const result = await service.validateSession();
      expect(result).toBe(true);
      expect(mockRefreshWorkOSToken).toHaveBeenCalledWith('rt');
    });

    it('returns true on network error (optimistic)', async () => {
      mockSignInWithWorkOS.mockResolvedValue({
        user: { userId: 'u1', email: 'a@b.com', name: 'Test', avatarUrl: '', orgId: null },
        tokens: { accessToken: 'at', refreshToken: 'rt' },
      });
      await service.signIn();
      vi.clearAllMocks();

      mockFetch.mockRejectedValue(new Error('network error'));
      const result = await service.validateSession();
      expect(result).toBe(true);
    });
  });

  describe('authState transitions', () => {
    function stubStoredCredentials(accessToken: string, refreshToken: string | null): void {
      mockCredGet.mockResolvedValue(accessToken);
      mockKvGet.mockImplementation((key: unknown) =>
        Promise.resolve(key === 'refreshToken' ? refreshToken : null)
      );
    }

    it('flips to reauth_required when the token is long-expired and refresh dies with invalid_grant', async () => {
      stubStoredCredentials(tokenWithExp(-3600), 'dead-refresh-token');
      mockRefreshWorkOSToken.mockRejectedValue(
        new Error('OauthException: Error: invalid_grant\nRefresh token already used')
      );

      const token = await service.getAccessToken();

      expect(token).toBeNull();
      expect(service.getAuthState()).toBe('reauth_required');
      expect((await service.getSession()).authState).toBe('reauth_required');
      expect(mockEventEmit).toHaveBeenCalledTimes(1);
      expect(mockEventEmit).toHaveBeenCalledWith(expect.anything(), {
        authState: 'reauth_required',
      });
    });

    it('broadcasts the transition once, not once per failing call', async () => {
      stubStoredCredentials(tokenWithExp(-3600), 'dead-refresh-token');
      mockRefreshWorkOSToken.mockRejectedValue(new Error('invalid_grant'));

      await service.getAccessToken();
      await service.getAccessToken();
      await service.getAccessToken();

      expect(mockEventEmit).toHaveBeenCalledTimes(1);
    });

    it('recovers to signed_in on a successful sign-in', async () => {
      stubStoredCredentials(tokenWithExp(-3600), 'dead-refresh-token');
      mockRefreshWorkOSToken.mockRejectedValue(new Error('invalid_grant'));
      await service.getAccessToken();
      expect(service.getAuthState()).toBe('reauth_required');

      mockSignInWithWorkOS.mockResolvedValue({
        user: { userId: 'u1', email: 'a@b.com', name: 'Test', avatarUrl: '', orgId: null },
        tokens: { accessToken: tokenWithExp(3600), refreshToken: 'fresh-rt' },
      });
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
      await service.signIn();

      expect(service.getAuthState()).toBe('signed_in');
      expect(mockEventEmit).toHaveBeenLastCalledWith(expect.anything(), {
        authState: 'signed_in',
      });
    });

    it('returns to signed_out on sign-out', async () => {
      stubStoredCredentials(tokenWithExp(-3600), 'dead-refresh-token');
      mockRefreshWorkOSToken.mockRejectedValue(new Error('invalid_grant'));
      await service.getAccessToken();

      await service.signOut();

      expect(service.getAuthState()).toBe('signed_out');
      expect(mockEventEmit).toHaveBeenLastCalledWith(expect.anything(), {
        authState: 'signed_out',
      });
    });

    it('stays signed_in when refresh succeeds for a near-expiry token', async () => {
      stubStoredCredentials(tokenWithExp(10), 'live-refresh-token');
      mockRefreshWorkOSToken.mockResolvedValue({
        accessToken: tokenWithExp(3600),
        refreshToken: 'rotated-rt',
      });

      const token = await service.getAccessToken();

      expect(token).not.toBeNull();
      expect(service.getAuthState()).toBe('signed_in');
      expect(mockEventEmit).not.toHaveBeenCalledWith(expect.anything(), {
        authState: 'reauth_required',
      });
    });
  });

  describe('checkServerHealth()', () => {
    it('returns true on successful health check', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const result = await service.checkServerHealth();
      expect(result).toBe(true);
    });

    it('returns false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('network error'));
      const result = await service.checkServerHealth();
      expect(result).toBe(false);
    });
  });
});
