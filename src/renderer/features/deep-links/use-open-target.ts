import { useCallback } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import type { OpenTargetNavigation } from './deep-link-navigation';

/** Navigates to an `OpenTargetNavigation` through the typed view navigator. */
export function useOpenTarget(): (target: OpenTargetNavigation) => void {
  const { navigate } = useNavigate();
  return useCallback(
    (target: OpenTargetNavigation) => {
      switch (target.view) {
        case 'work-list':
          navigate('work-list', target.params);
          return;
        case 'artifact-link':
          navigate('artifact-link', target.params);
          return;
        case 'public-link':
          navigate('public-link', target.params);
          return;
        case 'external':
          void rpc.app.openExternal(target.url);
          return;
      }
    },
    [navigate]
  );
}
