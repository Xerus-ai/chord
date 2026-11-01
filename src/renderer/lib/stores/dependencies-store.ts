import { create } from 'zustand';
import type {
  DependencyId,
  DependencyInstallResult,
  DependencyState,
  DependencyStatusMap,
  DependencyStatusUpdatedEvent,
} from '@shared/dependencies';
import { dependencyStatusUpdatedChannel } from '@shared/events/appEvents';
import { events, rpc } from '../../lib/ipc';
import { Resource } from './resource';

interface DependenciesState {
  installingKeys: Set<string>;
}

export class DependenciesStore {
  readonly local: Resource<DependencyStatusMap, DependencyStatusUpdatedEvent>;

  private readonly _remoteStores = new Map<string, Resource<DependencyStatusMap>>();
  private readonly _inFlightInstalls = new Map<string, Promise<DependencyInstallResult>>();
  private readonly _zustand = create<DependenciesState>()(() => ({
    installingKeys: new Set<string>(),
  }));

  constructor() {
    this.local = new Resource<DependencyStatusMap, DependencyStatusUpdatedEvent>(async () => {
      const result = await rpc.dependencies.getAll();
      return (result ?? {}) as DependencyStatusMap;
    }, [
      {
        kind: 'event',
        subscribe: (handler) => events.on(dependencyStatusUpdatedChannel, handler),
        onEvent: ({ id, state, connectionId }, ctx) => {
          if (connectionId) {
            const remote = this.getRemote(connectionId);
            remote.setValue({ ...(remote.data ?? {}), [id]: state as DependencyState });
            return;
          }
          ctx.set({ ...(ctx.data ?? {}), [id]: state as DependencyState });
        },
      },
    ]);
  }

  get allStatuses(): DependencyStatusMap {
    return this.local.data ?? {};
  }

  get agentStatuses(): DependencyStatusMap {
    return Object.fromEntries(
      Object.entries(this.allStatuses).filter(([, s]) => s.category === 'agent')
    );
  }

  get localInstalledAgents(): string[] {
    return Object.entries(this.agentStatuses)
      .filter(([, s]) => s.status === 'available')
      .map(([id]) => id);
  }

  getRemote(connectionId: string): Resource<DependencyStatusMap> {
    let store = this._remoteStores.get(connectionId);
    if (!store) {
      store = new Resource<DependencyStatusMap>(
        () => this.loadAgentStatuses(connectionId),
        [{ kind: 'demand' }]
      );
      this._remoteStores.set(connectionId, store);
    }
    return store;
  }

  remoteInstalledAgents(connectionId: string): string[] {
    const data = this.getRemote(connectionId).data;
    if (!data) return [];
    return Object.entries(data)
      .filter(([, s]) => s.status === 'available')
      .map(([id]) => id);
  }

  isInstalling(id: DependencyId, connectionId?: string): boolean {
    return this._zustand.getState().installingKeys.has(this.installKey(id, connectionId));
  }

  useIsInstalling(id: DependencyId, connectionId?: string): boolean {
    const key = this.installKey(id, connectionId);
    return this._zustand((s) => s.installingKeys.has(key));
  }

  subscribeInstallingKeys(): Set<string> {
    return this._zustand.getState().installingKeys;
  }

  get zustandStore() {
    return this._zustand;
  }

  async install(id: DependencyId, connectionId?: string): Promise<DependencyInstallResult> {
    const key = this.installKey(id, connectionId);
    const existing = this._inFlightInstalls.get(key);
    if (existing) return existing;

    const install = this.runInstall(id, connectionId, key);
    this._inFlightInstalls.set(key, install);
    return install;
  }

  private async runInstall(
    id: DependencyId,
    connectionId: string | undefined,
    key: string
  ): Promise<DependencyInstallResult> {
    this._zustand.setState((prev) => ({
      installingKeys: new Set([...prev.installingKeys, key]),
    }));

    try {
      const result = (await rpc.dependencies.install(id, connectionId)) as DependencyInstallResult;
      if (!result.success) return result;

      await this.refreshAgents(connectionId);
      return result;
    } finally {
      this._inFlightInstalls.delete(key);
      this._zustand.setState((prev) => {
        const next = new Set(prev.installingKeys);
        next.delete(key);
        return { installingKeys: next };
      });
    }
  }

  async probeAll(): Promise<void> {
    await rpc.dependencies.probeAll();
    this.local.invalidate();
  }

  async refreshAgents(connectionId?: string): Promise<void> {
    const statuses = await this.loadAgentStatuses(connectionId);
    if (connectionId) {
      this.getRemote(connectionId).setValue(statuses);
      return;
    }
    this.local.setValue(statuses);
  }

  start(): void {
    this.local.start();
  }

  dispose(): void {
    this.local.dispose();
    for (const store of this._remoteStores.values()) {
      store.dispose();
    }
    this._remoteStores.clear();
  }

  private installKey(id: DependencyId, connectionId?: string): string {
    return `${connectionId ?? 'local'}:${id}`;
  }

  private async loadAgentStatuses(connectionId?: string): Promise<DependencyStatusMap> {
    await rpc.dependencies.probeCategory('agent', connectionId);
    const all = await rpc.dependencies.getAll(connectionId);
    return (all ?? {}) as DependencyStatusMap;
  }
}
