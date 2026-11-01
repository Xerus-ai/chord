import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from '../components/SettingRow';
import { LayerBadge, LayeredField } from './layered-field';
import { RepoWorktreeSourcesRows } from './repo-worktree-sources-rows';
import type { RepoSettingsData, useRepoSettings } from './use-repo-settings';

type Writes = Pick<ReturnType<typeof useRepoSettings>, 'saveJustMe' | 'saveTeam'>;

/**
 * Repo › General: where lanes fork from, keeping the local base current, where
 * checkouts go, and which checkouts made outside Chord the sidebar lists.
 */
export function RepoGeneralSection({ data, writes }: { data: RepoSettingsData; writes: Writes }) {
  const { config, justMe, repo } = data;
  const [choosing, setChoosing] = useState(false);
  if (!config) return null;

  const chooseFolder = async () => {
    setChoosing(true);
    try {
      const selected = await rpc.app.openSelectDirectoryDialog({
        title: `Checkouts of ${repo.alias}`,
        message: "Choose the folder this repository's checkouts go in",
      });
      if (selected) await writes.saveJustMe({ worktreeFolder: selected });
    } finally {
      setChoosing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <LayeredField
        title="Base branch"
        description="New lanes fork from this branch, fetched first, and open their pull request against it."
        value={config.baseBranch.value}
        layer={config.baseBranch.layer}
        emptyLabel="The remote's default branch"
        onSaveJustMe={(value) => writes.saveJustMe({ baseBranch: value })}
        onSaveTeam={
          data.teamFile.writeBlocked === null
            ? (value) => writes.saveTeam({ baseBranch: value })
            : undefined
        }
      />

      <SettingRow
        title={
          <span className="flex items-center gap-2">
            Keep local base up to date <LayerBadge layer={config.keepLocalBaseUpToDate.layer} />
          </span>
        }
        description="When a new lane fetches its base, also fast-forward your local branch of that name. A branch that is checked out somewhere, or has commits of its own, is left alone."
        control={
          <Switch
            checked={config.keepLocalBaseUpToDate.value}
            onCheckedChange={(checked) =>
              void writes.saveJustMe({ keepLocalBaseUpToDate: checked ? true : null })
            }
            aria-label="Keep local base up to date"
          />
        }
      />

      <SettingRow
        title={
          <span className="flex items-center gap-2">
            Worktree folder <LayerBadge layer={justMe.worktreeFolder ? 'justMe' : 'default'} />
          </span>
        }
        description={<span className="font-mono">{data.poolPath}</span>}
        control={
          <>
            {justMe.worktreeFolder && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void writes.saveJustMe({ worktreeFolder: null })}
              >
                Use default
              </Button>
            )}
            <Button
              variant="outline"
              size="xs"
              disabled={choosing}
              onClick={() => void chooseFolder()}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Choose…
            </Button>
          </>
        }
      />

      <RepoWorktreeSourcesRows justMe={justMe} saveJustMe={writes.saveJustMe} />
    </div>
  );
}
