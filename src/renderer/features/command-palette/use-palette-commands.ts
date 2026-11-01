import {
  FileText,
  FolderOpen,
  GitCommitHorizontal,
  GitPullRequest,
  Home,
  Layers,
  MessageSquare,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Server,
  Settings,
  Square,
  Terminal,
} from 'lucide-react';
import { useCallback, type ComponentType } from 'react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { rpc } from '@renderer/lib/ipc';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';

export interface CommandEntry {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  keywords?: string[];
  shortcut?: string;
  green?: boolean;
  action: () => void | Promise<void>;
}

export interface CommandGroupSpec {
  heading: string;
  commands: CommandEntry[];
}

function aliasFromPath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'repo';
}

export function usePaletteCommands(): CommandGroupSpec[] {
  const { navigate } = useNavigate();
  const { toggleLeft, toggleRight } = useWorkspaceLayoutContext();
  const { toggleTheme } = useTheme();
  const { toast } = useToast();
  const { params } = useParams('work-list');
  // The Agent and Git commands dispatch chord:* events whose listeners live
  // inside the open work-item panel. With none open, firing one was invisible
  // to the user AND to telemetry — a CustomEvent into a window with no
  // listener fails silently. Hidden rather than offered as a no-op.
  const hasWorkItem = params.workItemId != null;

  // Picking a folder is only half the action — onboarding registers the repo,
  // and so does this. A discarded path made the command look broken.
  const openFolder = useCallback(async () => {
    let selectedPath: string | undefined;
    try {
      selectedPath = await rpc.app.openSelectDirectoryDialog({
        title: 'Open Folder',
        message: 'Select a project folder',
      });
    } catch (error) {
      toast({
        title: 'Could not open the folder picker',
        description: error instanceof Error ? error.message : 'The dialog failed to open.',
        variant: 'destructive',
      });
      return;
    }
    if (!selectedPath) return;

    const alias = aliasFromPath(selectedPath);
    try {
      const result = await rpc.repos.create({ path: selectedPath, alias });
      if (!result.success) {
        toast({
          title: 'Could not add that folder',
          description: `${result.error.path} is not a git repository.`,
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Repository added',
        description: `${alias} is ready to use for new work items.`,
      });
      navigate('work-list');
    } catch (error) {
      toast({
        title: 'Could not add that folder',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  }, [navigate, toast]);

  return [
    {
      heading: 'Work',
      commands: [
        {
          id: 'new-work-item',
          label: 'New Work Item',
          icon: Plus,
          keywords: ['create', 'task', 'add'],
          // AppSidebar handles this and is always mounted, so the modal opens
          // directly. The old navigate-then-setTimeout(100) was a race: a
          // work-list mount slower than 100ms dropped the event entirely.
          action: () => {
            window.dispatchEvent(new CustomEvent('chord:create-work-item'));
          },
        },
        {
          id: 'open-folder',
          label: 'Open Folder',
          icon: FolderOpen,
          keywords: ['browse', 'directory', 'project', 'repository'],
          action: openFolder,
        },
      ],
    },
    ...(!hasWorkItem
      ? []
      : [
          {
            heading: 'Agent',
            commands: [
              {
                id: 'focus-chat',
                label: 'Focus Chat Input',
                icon: MessageSquare,
                keywords: ['message', 'prompt', 'send', 'agent'],
                action: () => {
                  window.dispatchEvent(new CustomEvent('chord:focus-chat'));
                },
              },
              {
                id: 'stop-agent',
                label: 'Stop Agent',
                icon: Square,
                keywords: ['cancel', 'halt', 'abort'],
                action: () => {
                  window.dispatchEvent(new CustomEvent('chord:stop-agent'));
                },
              },
              {
                id: 'open-terminal',
                label: 'Open Terminal',
                icon: Terminal,
                keywords: ['shell', 'bash', 'console'],
                action: () => {
                  window.dispatchEvent(new CustomEvent('chord:create-terminal'));
                },
              },
            ],
          },
          {
            heading: 'Git',
            commands: [
              {
                // One command because there is one behaviour: the handler stages,
                // commits under the work item's name and pushes, whichever of
                // 'commit'/'push' it receives. Two labels promised a commit that
                // stayed local and a push that did not commit; neither existed.
                id: 'git-commit-push',
                label: 'Git: Commit & Push',
                icon: GitCommitHorizontal,
                keywords: ['save', 'changes', 'commit', 'push', 'upload', 'remote'],
                action: () => {
                  window.dispatchEvent(new CustomEvent('chord:git-action', { detail: 'commit' }));
                },
              },
              {
                id: 'git-create-pr',
                label: 'Git: Create Pull Request',
                icon: GitPullRequest,
                keywords: ['pr', 'merge', 'review'],
                green: true,
                action: () => {
                  window.dispatchEvent(
                    new CustomEvent('chord:git-action', { detail: 'create-pr' })
                  );
                },
              },
            ],
          },
        ]),
    {
      heading: 'Navigation',
      commands: [
        {
          id: 'dashboard',
          label: 'Go to Dashboard',
          icon: Home,
          action: () => navigate('dashboard'),
        },
        {
          id: 'work-list',
          label: 'Go to Work List',
          icon: FileText,
          keywords: ['work', 'items', 'tasks'],
          action: () => navigate('work-list'),
        },
        {
          id: 'settings',
          label: 'Go to Settings',
          icon: Settings,
          keywords: ['preferences', 'config'],
          action: () => navigate('settings'),
        },
        {
          id: 'skills',
          label: 'Go to Skills',
          icon: Layers,
          keywords: ['marketplace'],
          action: () => navigate('settings', { tab: 'skills' }),
        },
        {
          id: 'mcp',
          label: 'Go to MCP Servers',
          icon: Server,
          keywords: ['model', 'context', 'protocol'],
          action: () => navigate('settings', { tab: 'mcp' }),
        },
      ],
    },
    {
      heading: 'View',
      commands: [
        {
          id: 'toggle-left',
          label: 'Toggle Left Sidebar',
          icon: PanelLeft,
          keywords: ['sidebar', 'panel'],
          action: () => toggleLeft(),
        },
        {
          id: 'toggle-right',
          label: 'Toggle Right Sidebar',
          icon: PanelRight,
          keywords: ['sidebar', 'panel'],
          action: () => toggleRight(),
        },
        {
          id: 'toggle-theme',
          label: 'Toggle Theme',
          icon: Moon,
          keywords: ['dark', 'light', 'mode'],
          action: () => toggleTheme(),
        },
      ],
    },
  ];
}
