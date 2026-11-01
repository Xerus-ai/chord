import {
  ArrowLeft,
  Bot,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  Monitor,
  Plug,
  Plus,
  Server,
  Share2,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { type CSSProperties } from 'react';
import type { SettingsCardId } from '@renderer/features/settings/settings-card-ids';
import {
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  tabForSettingsCard,
  type SettingsTabId,
} from '@renderer/features/settings/settings-cards';
import { usePublicUrls } from '@renderer/features/settings/use-public-urls';
import { useReturnFromSettings } from '@renderer/features/settings/use-return-from-settings';
import { useMacWindowButtonsShown } from '@renderer/lib/hooks/use-mac-window-buttons-shown';
import { useRepos } from '@renderer/lib/hooks/use-repos';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { addExistingRepositoryFromFolder } from '../create-repository';
import { SettingsSearch } from './SettingsSearch';

const TAB_ICONS: Record<Exclude<SettingsTabId, 'docs'>, LucideIcon> = {
  general: User,
  interface: Monitor,
  sharing: Share2,
  'clis-models': Bot,
  artifacts: FileText,
  skills: Sparkles,
  mcp: Server,
  repository: FolderGit2,
  git: GitBranch,
  team: Users,
  rules: ShieldCheck,
  integrations: Plug,
};

const NAV_ITEM =
  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body tracking-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text';
const NAV_ITEM_ACTIVE = 'bg-surface-inset text-text hover:bg-surface-inset';
const GROUP_LABEL =
  'px-2.5 pb-1 pt-4 text-micro tracking-micro font-semibold uppercase text-text-passive';

/**
 * The settings rail (devstation-9kwt). Replaces the sessions sidebar while
 * settings is open — same column, so the main pane never moves — and owns
 * Back to app, search, the grouped tabs, and a Repositories group that opens
 * each repository's own page in one click (devstation-ec3h).
 */
export function SettingsSidebar() {
  const { params, setParams } = useParams('settings');
  const returnToApp = useReturnFromSettings();
  const { data: publicUrls } = usePublicUrls();
  const { repos } = useRepos();
  const macWindowButtonsShown = useMacWindowButtonsShown();

  const activeTab = params.repoId ? 'repository' : (params.tab ?? 'general');

  const selectTab = (tab: SettingsTabId) =>
    setParams({ tab, card: undefined, repoId: undefined, repoSection: undefined });
  const selectCard = (card: SettingsCardId) =>
    setParams({ tab: tabForSettingsCard(card), card, repoId: undefined, repoSection: undefined });
  const selectRepo = (repoId: string) =>
    setParams({ tab: 'repository', card: undefined, repoId, repoSection: undefined });

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-canvas">
      {/* Carries the window drag region, like the sessions rail's top bar. */}
      <div
        className={cn('flex h-11 shrink-0 items-center px-2', macWindowButtonsShown && 'pl-[76px]')}
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <button
          type="button"
          onClick={returnToApp}
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-body tracking-body text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ArrowLeft className="size-4" />
          Back to app
        </button>
      </div>

      <div className="border-b border-border-subtle px-2 pb-2">
        <SettingsSearch onSelect={selectCard} />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {SETTINGS_GROUPS.map((group) => {
          const tabs = SETTINGS_TABS.filter((tab) => tab.group === group.id);
          if (tabs.length === 0) return null;
          return (
            <div key={group.id} className="flex flex-col gap-0.5">
              <div className={GROUP_LABEL}>{group.label}</div>
              {tabs.map((tab) => {
                const Icon = TAB_ICONS[tab.id as Exclude<SettingsTabId, 'docs'>];
                const active = tab.id === activeTab && !params.repoId;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => selectTab(tab.id)}
                    className={cn(NAV_ITEM, active && NAV_ITEM_ACTIVE)}
                  >
                    <Icon className="size-4 shrink-0 opacity-80" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}

        <div className="flex flex-col gap-0.5">
          <div className={GROUP_LABEL}>Repositories</div>
          {repos.map((repo) => {
            const active = params.repoId === repo.id;
            return (
              <button
                key={repo.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => selectRepo(repo.id)}
                title={repo.path}
                className={cn(NAV_ITEM, active && NAV_ITEM_ACTIVE)}
              >
                <span className="flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-active-solid text-micro tracking-micro font-semibold uppercase text-text-muted">
                  {repo.alias.charAt(0)}
                </span>
                <span className="truncate">{repo.alias}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => void addExistingRepositoryFromFolder()}
            className={cn(NAV_ITEM, 'text-text-passive')}
          >
            <Plus className="size-4 shrink-0" />
            Add repository
          </button>
        </div>

        <div className="mb-2 mt-4 h-px bg-border-subtle" />
        <button
          type="button"
          disabled={!publicUrls}
          onClick={() => {
            if (publicUrls) void rpc.app.openExternal(publicUrls.docs);
          }}
          className={cn(NAV_ITEM, 'disabled:cursor-not-allowed disabled:text-text-disabled')}
        >
          <span className="truncate">Docs</span>
          <ExternalLink className="size-4" />
        </button>
      </nav>
    </div>
  );
}
