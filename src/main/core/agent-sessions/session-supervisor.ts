import type { TransportMode } from '@main/core/work-items/active-sessions';
import { log } from '@main/lib/logger';

type SpawnMode = 'fresh' | 'resume';

type SpawnToken = {
  mode: SpawnMode;
  freshRecovery: boolean;
};

type ActiveRuntime = {
  mode: SpawnMode;
  freshRecovery: boolean;
};

type SessionRuntime = {
  desired: boolean;
  active?: ActiveRuntime;
  spawnInFlight?: SpawnToken;
  consecutiveResumeExits: number;
  recoveryGraceTimer?: ReturnType<typeof setTimeout>;
  transport?: TransportMode;
};

export type ExitDecision =
  | { kind: 'stale' }
  | { kind: 'stopped' }
  | { kind: 'failed' }
  | { kind: 'respawnFresh' }
  | { kind: 'respawnResume' };

export const MAX_RESUME_ATTEMPTS = 1;
export const FRESH_RECOVERY_GRACE_MS = 5_000;

export class SessionSupervisor {
  private runtimes = new Map<string, SessionRuntime>();

  beginStart(
    sessionId: string,
    options: { requireDesired?: boolean; mode?: SpawnMode; transport?: TransportMode } = {}
  ): SpawnToken | undefined {
    const runtime = this.getOrCreateRuntime(sessionId);
    if (runtime.active || runtime.spawnInFlight) return undefined;
    if (options.requireDesired === true && !runtime.desired) return undefined;

    runtime.desired = true;
    if (options.transport) runtime.transport = options.transport;
    const mode = options.mode ?? 'fresh';
    const token: SpawnToken = {
      mode,
      freshRecovery: mode === 'fresh' && runtime.consecutiveResumeExits >= MAX_RESUME_ATTEMPTS,
    };
    runtime.spawnInFlight = token;
    return token;
  }

  acceptSpawn(sessionId: string, token: SpawnToken): boolean {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlight !== token) return false;

    runtime.spawnInFlight = undefined;
    if (!runtime.desired) return false;

    runtime.active = {
      mode: token.mode,
      freshRecovery: token.freshRecovery,
    };
    if (token.freshRecovery) {
      this.scheduleRecoveryReset(sessionId, runtime);
    }
    return true;
  }

  failSpawn(sessionId: string, token: SpawnToken): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || runtime.spawnInFlight !== token) return;
    runtime.spawnInFlight = undefined;
  }

  stop(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return;

    runtime.desired = false;
    runtime.spawnInFlight = undefined;
    this.clearRecoveryGraceTimer(runtime);
    runtime.active = undefined;
    runtime.consecutiveResumeExits = 0;
  }

  isDesired(sessionId: string): boolean {
    return this.runtimes.get(sessionId)?.desired === true;
  }

  handleExit(sessionId: string): ExitDecision {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime || !runtime.active) return { kind: 'stale' };

    const exitedMode = runtime.active.mode;
    const freshRecovery = runtime.active.freshRecovery;
    runtime.active = undefined;
    runtime.spawnInFlight = undefined;
    this.clearRecoveryGraceTimer(runtime);

    if (!runtime.desired) return { kind: 'stopped' };

    if (exitedMode === 'resume') {
      runtime.consecutiveResumeExits += 1;
      if (runtime.consecutiveResumeExits >= MAX_RESUME_ATTEMPTS) {
        runtime.consecutiveResumeExits = MAX_RESUME_ATTEMPTS;
        return { kind: 'respawnFresh' };
      }
      return { kind: 'respawnResume' };
    }

    if (freshRecovery && runtime.consecutiveResumeExits >= MAX_RESUME_ATTEMPTS) {
      runtime.desired = false;
      runtime.consecutiveResumeExits = 0;
      return { kind: 'failed' };
    }

    runtime.consecutiveResumeExits = 0;
    return { kind: 'respawnResume' };
  }

  forget(sessionId: string): void {
    const runtime = this.runtimes.get(sessionId);
    if (runtime) this.clearRecoveryGraceTimer(runtime);
    this.runtimes.delete(sessionId);
  }

  getTransport(sessionId: string): TransportMode | undefined {
    return this.runtimes.get(sessionId)?.transport;
  }

  private scheduleRecoveryReset(sessionId: string, runtime: SessionRuntime): void {
    this.clearRecoveryGraceTimer(runtime);
    runtime.recoveryGraceTimer = setTimeout(() => {
      if (this.runtimes.get(sessionId) !== runtime) return;
      if (!runtime.active?.freshRecovery) return;

      runtime.active = {
        ...runtime.active,
        freshRecovery: false,
      };
      runtime.consecutiveResumeExits = 0;
      runtime.recoveryGraceTimer = undefined;
      log.debug('session-supervisor: recovery grace period elapsed, reset counters', { sessionId });
    }, FRESH_RECOVERY_GRACE_MS);
  }

  private clearRecoveryGraceTimer(runtime: SessionRuntime): void {
    if (!runtime.recoveryGraceTimer) return;
    clearTimeout(runtime.recoveryGraceTimer);
    runtime.recoveryGraceTimer = undefined;
  }

  private getOrCreateRuntime(sessionId: string): SessionRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      runtime = {
        desired: false,
        consecutiveResumeExits: 0,
      };
      this.runtimes.set(sessionId, runtime);
    }
    return runtime;
  }
}
