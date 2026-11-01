import { useCallback, useEffect, type ReactNode } from 'react';
import {
  SettingsPage,
  type SettingsPageTab,
} from '@renderer/features/settings/components/SettingsPage';
import {
  RepoSettingsPage,
  type RepoSettingsSection,
} from '@renderer/features/settings/repo-page/repo-settings-page';
import type { SettingsCardId } from '@renderer/features/settings/settings-card-ids';
import { useReturnFromSettings } from '@renderer/features/settings/use-return-from-settings';
import { useParams } from '@renderer/lib/layout/navigation-provider';

/**
 * Minimal passthrough — exists so the registry can infer WrapParams<'settings'>
 * from its props. The panel reads the tab straight off the view params, so the
 * wrapper has nothing to hand down.
 */
export function SettingsViewWrapper({
  children,
}: {
  children: ReactNode;
  tab?: SettingsPageTab;
  card?: SettingsCardId;
  /** Settings › Repository › this repository's own page. */
  repoId?: string;
  /** The section of that page to open at (the Run tab's "Set up Run & test"). */
  repoSection?: RepoSettingsSection;
}) {
  return <>{children}</>;
}

export function SettingsTitlebar() {
  return null;
}

/** Escape leaves settings, unless something closer owns the key. */
function isEscapeOwnedElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return (
    document.querySelector(
      '[role="dialog"], [data-slot="popover-content"], [data-slot="select-content"], [data-slot="dropdown-menu-content"], [data-slot="context-menu-content"], [data-slot="combobox-content"]'
    ) !== null
  );
}

export function SettingsMainPanel() {
  const { params, setParams } = useParams('settings');
  const returnToApp = useReturnFromSettings();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (isEscapeOwnedElsewhere(event.target)) return;
      event.preventDefault();
      returnToApp();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [returnToApp]);

  const handleRepoBack = useCallback(() => {
    setParams({
      tab: 'repository',
      card: 'repositories',
      repoId: undefined,
      repoSection: undefined,
    });
  }, [setParams]);

  // Keyed on what is shown, so a tab or repo change re-runs the pane-in
  // animation — the settings rail keeps the same key and stays put.
  const paneKey = params.repoId ?? params.tab ?? 'general';

  return (
    <div
      key={paneKey}
      className="animate-pane-in relative z-10 flex min-h-0 flex-1 overflow-hidden bg-surface"
    >
      {params.repoId ? (
        <RepoSettingsPage
          repoId={params.repoId}
          section={params.repoSection}
          onBack={handleRepoBack}
        />
      ) : (
        <SettingsPage tab={params.tab ?? 'general'} card={params.card} />
      )}
    </div>
  );
}

export const settingsView = {
  WrapView: SettingsViewWrapper,
  TitlebarSlot: SettingsTitlebar,
  MainPanel: SettingsMainPanel,
};
