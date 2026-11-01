import { FolderOpen } from 'lucide-react';
import React, { useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

/**
 * Settings › General: where lanes' checkouts go — one folder per repository
 * under it (`lane-pool-path.ts`), unless the repository chose its own on its
 * page. Read when a lane is created, so existing lanes stay where they are.
 */
const WorktreeRootCard: React.FC = () => {
  const {
    value: localProject,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('localProject');
  const [choosing, setChoosing] = useState(false);

  if (!localProject) return null;

  const chooseFolder = async () => {
    setChoosing(true);
    try {
      const selected = await rpc.app.openSelectDirectoryDialog({
        title: 'Worktree folder',
        message: "Choose the folder new lanes' checkouts go in",
      });
      if (selected) update({ defaultWorktreeDirectory: selected });
    } finally {
      setChoosing(false);
    }
  };

  return (
    <SettingRow
      title="Checkouts of new lanes"
      description={
        <span className="flex flex-col gap-1">
          <span>
            Each repository gets a folder of its own in here; a repository can choose another on its
            page. Lanes that already exist stay where they are.
          </span>
          <span className="font-mono text-text">{localProject.defaultWorktreeDirectory}</span>
        </span>
      }
      control={
        <>
          <ResetToDefaultButton
            visible={isFieldOverridden('defaultWorktreeDirectory')}
            onReset={() => resetField('defaultWorktreeDirectory')}
            disabled={loading || saving}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void chooseFolder()}
            disabled={loading || saving || choosing}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose…
          </Button>
        </>
      }
    />
  );
};

export default WorktreeRootCard;
