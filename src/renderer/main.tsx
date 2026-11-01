import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './lib/components/error-boundary';
import './index.css';
import 'devicon/devicon.min.css';
import type { NavigationSnapshot } from '@shared/view-state';
import { wireLaneRunInvalidation } from '@renderer/features/right-rail/run/use-lane-runs';
import { wireSoloInvalidation } from '@renderer/features/right-rail/run/use-solo';
import { wireLaneSetupInvalidation } from '@renderer/features/work-list/use-work-item-worktrees';
import { wireCommitHistoryInvalidation } from '@renderer/lib/commit-history-invalidation';
import { wireRepoIconInvalidation } from '@renderer/lib/hooks/use-repos';
import { wireWorkItemProvisionInvalidation } from '@renderer/lib/hooks/use-work-items';
import { wireAccountStateInvalidation } from '@renderer/lib/hooks/useAccount';
import { rpc } from '@renderer/lib/ipc';
import { wireModelRegistryInvalidation } from '@renderer/lib/monaco/invalidation-bridges';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { wirePrCacheInvalidation } from '@renderer/lib/pr-cache-invalidation';
import { log } from '@renderer/utils/logger';
import { initSoundPlayer } from '@renderer/utils/soundPlayer';
import { navigationStore } from './lib/stores/navigation-store';
import { useUpdateStore } from './lib/stores/update-store';
import './lib/stores/app-state';

async function bootstrap() {
  wireModelRegistryInvalidation(modelRegistry);
  wirePrCacheInvalidation();
  wireCommitHistoryInvalidation();
  wireAccountStateInvalidation();
  wireWorkItemProvisionInvalidation();
  wireLaneSetupInvalidation();
  wireLaneRunInvalidation();
  wireSoloInvalidation();
  wireRepoIconInvalidation();

  useUpdateStore.getState().start();
  initSoundPlayer();

  const navResult = await (rpc.viewState.get('navigation') as Promise<NavigationSnapshot> | null);
  if (navResult) navigationStore.getState().restoreSnapshot(navResult);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

bootstrap().catch((error: unknown) => {
  log.error('Renderer bootstrap failed:', error);
});
