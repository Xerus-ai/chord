import { useHotkey } from '@tanstack/react-hotkeys';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { WorkItemRow } from '@main/db/schema-work-items';
import { useWorkItemArtifacts } from '@renderer/features/artifacts/use-work-item-artifacts';
import { LocalWorkItemRail } from '@renderer/features/right-rail/local-rail';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useLocalSharingAvailability } from '@renderer/features/sharing/use-local-sharing-availability';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { rpc } from '@renderer/lib/ipc';
import { RepoFilesContext } from '@renderer/lib/ui/repo-files-context';
import { filePathTab } from './center-tab';
import { openCenterTab, useCenterTabs, useOpenCenterTabs } from './center-tabs-store';
import { ChatTopbar } from './chat-topbar';
import { listEndedChats } from './ended-chats';
import { FileFinder } from './file-finder';
import { LauncherMenu } from './launcher-menu';
import { OwnerDocumentBody } from './owner-document-body';
import { offersDocumentTo, type PaneHost } from './pane-host';
import { PrMergedBanner } from './pr-merged-banner';
import { SessionPanel } from './session-panel';
import { TurnStreamProvider } from './turn-stream-context';
import { useOwnerPaletteListeners } from './use-owner-palette-listeners';
import { useReconcileCenterTabs } from './use-reconcile-center-tabs';
import { useRepoFiles } from './use-repo-files';
import { useWorkItemGit } from './use-work-item-git';
import { useWorkItemSessions } from './use-work-item-sessions';
import { useWorkItemWorktrees } from './use-work-item-worktrees';
import { resolveWorkItemCapabilities } from './work-item-access';
import type { WorkItemSource } from './work-item-source';
import { WorkItemView } from './work-item-view';
import { WorkspaceProvisioningBar } from './workspace-provisioning-bar';

/** The owner of a local work item can do everything (work-item-access.ts). */
const OWNER_CAPABILITIES = resolveWorkItemCapabilities({
  viewer: 'owner',
  role: 'edit',
  scope: 'work_item',
  approvalPolicy: 'owner',
});
const offersEveryOwnerDocument = offersDocumentTo(OWNER_CAPABILITIES, null);

/**
 * The owner's source: everything here talks to the local DB, the checkout and
 * the PTY/session machinery, so none of these hooks, effects or chord:*
 * listeners exist while a cloud item is on screen. One `TurnStreamProvider`
 * sits above every pane, so all session bodies share the item's turn stream
 * wherever they are split to.
 */
export function LocalWorkItemView({
  item,
  onItemChanged,
}: {
  item: WorkItemRow;
  onItemChanged: () => void;
}) {
  const tabs = useCenterTabs(item.id);
  const openTabs = useOpenCenterTabs(item.id);
  const { sessions, loadSessions, closeSession } = useWorkItemSessions(item.id);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const { files: repoFiles, fileSet: repoFileSet } = useRepoFiles(item.id);
  const artifactsQuery = useWorkItemArtifacts(item.id);
  const sharing = useLocalSharingAvailability(item);
  const { prInfo } = useWorkItemGit(item.id);
  const artifactIds = useMemo(
    () =>
      artifactsQuery.data && !artifactsQuery.isFetching
        ? new Set(artifactsQuery.data.map((a) => a.id))
        : null,
    [artifactsQuery.data, artifactsQuery.isFetching]
  );
  const worktrees = useWorkItemWorktrees(item.id);
  const liveWorktreeIds = useMemo(
    () => (worktrees ? new Set(worktrees.map((w) => w.id)) : null),
    [worktrees]
  );
  const pathArtifacts = useMemo(
    () =>
      artifactsQuery.data?.map((a) => ({
        id: a.id,
        name: a.name,
        repoRelativePath: a.repoRelativePath,
      })) ?? null,
    [artifactsQuery.data]
  );
  const missingArtifactIds = useReconcileCenterTabs(tabs, {
    artifactIds,
    pathArtifacts,
    primaryWorktreeId: worktrees?.find((w) => w.isPrimary)?.id,
    repoFiles: repoFileSet,
    liveWorktreeIds,
    openTabs,
  });
  const { value: keyboard } = useAppSettingsKey('keyboard');

  useHotkey(getHotkeyRegistration('fileFinder', keyboard), () => setFileFinderOpen(true), {
    enabled: getEffectiveHotkey('fileFinder', keyboard) !== null,
  });
  useOwnerPaletteListeners({
    item,
    sessions,
    loadSessions,
    enabled: OWNER_CAPABILITIES.paletteActions,
  });

  const handleRename = useCallback(
    (newName: string) => {
      rpc.workItems
        .update({ id: item.id, name: newName })
        .then(() => onItemChanged())
        .catch(() => {});
    },
    [item.id, onItemChanged]
  );
  const handleMarkDone = useCallback(async () => {
    await rpc.workItems.update({ id: item.id, status: 'done' });
  }, [item.id]);

  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);
  const endedChats = useMemo(() => listEndedChats(sessions), [sessions]);

  const source = useMemo<WorkItemSource>(
    () => ({
      kind: 'local',
      scope: 'work_item',
      workItemId: item.id,
      layoutKey: item.id,
      capabilities: OWNER_CAPABILITIES,
    }),
    [item.id]
  );

  const paneHost = useMemo<PaneHost>(
    () => ({
      layoutKey: item.id,
      offersDocument: offersEveryOwnerDocument,
      sessions: {
        byId: sessionsById,
        // Closing an owner's session tab ends a live session; an ended one just closes.
        close: closeSession,
        renderLauncher: (focusedWorktreeId) => (
          <LauncherMenu
            workItemId={item.id}
            focusedWorktreeId={focusedWorktreeId}
            endedChats={endedChats}
            // Same path as every other "show this session" request: the owner view
            // opens the tab in the focused pane and reloads its session rows.
            onOpenSession={(sessionId) =>
              window.dispatchEvent(
                new CustomEvent('chord:switch-tab', { detail: { kind: 'session', sessionId } })
              )
            }
            onOpenFile={() => setFileFinderOpen(true)}
          />
        ),
        emptyLabel: 'No conversations. Start one from +',
      },
      renderDocument: (tab, context) => (
        <OwnerDocumentBody workItemId={item.id} tab={tab} context={context} />
      ),
      missingArtifactIds,
    }),
    [item.id, sessionsById, endedChats, closeSession, missingArtifactIds]
  );

  const sessionBodies = useMemo(
    () => ({
      byId: sessionsById,
      render: (session: (typeof sessions)[number]) => <SessionPanel session={session} />,
    }),
    [sessionsById]
  );
  const bodyProviders = useCallback(
    (bodies: ReactNode) => <TurnStreamProvider workItemId={item.id}>{bodies}</TurnStreamProvider>,
    [item.id]
  );

  const showMergeBanner = prInfo?.status === 'merged' && item.status !== 'done' && !bannerDismissed;

  return (
    <RepoFilesContext.Provider value={repoFileSet}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <WorkItemView
          source={source}
          paneHost={paneHost}
          header={(focused) => (
            <ChatTopbar
              title={item.name}
              repoBadge={item.repoAlias ?? ''}
              repoPath={item.repoPath}
              workItemId={item.id}
              sharing={sharing}
              activeArtifactId={focused?.kind === 'path' ? (focused.artifactId ?? null) : null}
              onRename={handleRename}
            />
          )}
          // Below the header: the header owns the window's top strip, where
          // Windows paints its caption buttons (devstation-pan7).
          banner={
            <>
              <WorkspaceProvisioningBar
                workItemId={item.id}
                provisionStatus={item.provisionStatus}
                provisionError={item.provisionError}
                lane={worktrees?.find((w) => w.isPrimary)}
              />
              {showMergeBanner && (
                <PrMergedBanner
                  prNumber={item.prNumber}
                  onMarkDone={() => void handleMarkDone()}
                  onDismiss={() => setBannerDismissed(true)}
                />
              )}
            </>
          }
          rail={() => <LocalWorkItemRail workItem={item} />}
          sessionBodies={sessionBodies}
          bodyProviders={bodyProviders}
        />
      </div>
      <FileFinder
        open={fileFinderOpen}
        onOpenChange={setFileFinderOpen}
        files={repoFiles}
        onSelect={(filePath) => openCenterTab(item.id, filePathTab(filePath), { preview: true })}
      />
    </RepoFilesContext.Provider>
  );
}
