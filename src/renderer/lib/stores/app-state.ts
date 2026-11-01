import { DependenciesStore } from './dependencies-store';
import { getNavigationSnapshot, navigationStore } from './navigation-store';
import { snapshotRegistry } from './snapshot-registry';
import { SshConnectionStore } from './ssh-connection-store';

export const dependenciesStore = new DependenciesStore();
export const sshConnectionStore = new SshConnectionStore({
  onConnectionReady: (connectionId) => void dependenciesStore.refreshAgents(connectionId),
});

snapshotRegistry.register('navigation', navigationStore, getNavigationSnapshot);
dependenciesStore.start();
sshConnectionStore.start();
