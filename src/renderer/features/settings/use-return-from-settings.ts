import { useCallback } from 'react';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { resolveSettingsReturn, settingsOriginStore } from '@renderer/lib/stores/settings-return';

/**
 * "Back to app": the view that opened settings, with the params it had, or
 * the dashboard when settings was the first view of the session.
 */
export function useReturnFromSettings(): () => void {
  const { navigate } = useNavigate();
  return useCallback(() => {
    const origin = resolveSettingsReturn(settingsOriginStore.getState().origin);
    (navigate as (viewId: string, params: Record<string, unknown>) => void)(
      origin.viewId,
      origin.params
    );
  }, [navigate]);
}
