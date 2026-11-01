import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FolderOpen, Trash2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import SkillIconRenderer from './SkillIconRenderer';
import { resolveCatalogSourceIcon } from './skillIcons';

export interface SkillDetailModalProps extends BaseModalProps<void> {
  /** Catalog entry the row was rendered from — shown while the full detail loads. */
  skill: CatalogSkill;
  onInstall: (skillId: string) => Promise<boolean>;
  onUninstall: (skillId: string) => Promise<boolean>;
  onOpenTerminal?: (skillPath: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

export function SkillDetailModal({
  skill: catalogSkill,
  onInstall,
  onUninstall,
  onOpenTerminal,
  onSuccess,
  onClose,
}: SkillDetailModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    data: detail,
    error: detailError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['skills', 'detail', catalogSkill.id],
    queryFn: async () => {
      const result = await rpc.skills.getDetail({ skillId: catalogSkill.id });
      if (result.success && result.data) return result.data;
      throw new Error(result.error ?? 'Failed to load skill detail');
    },
  });

  const skill = detail ?? catalogSkill;

  const handleInstall = useCallback(async () => {
    setIsProcessing(true);
    try {
      if (await onInstall(skill.id)) onSuccess();
    } finally {
      setIsProcessing(false);
    }
  }, [skill.id, onInstall, onSuccess]);

  const handleUninstall = useCallback(async () => {
    setIsProcessing(true);
    try {
      if (await onUninstall(skill.id)) onSuccess();
    } finally {
      setIsProcessing(false);
    }
  }, [skill.id, onUninstall, onSuccess]);

  const handleOpen = useCallback(() => {
    if (skill.localPath && onOpenTerminal) onOpenTerminal(skill.localPath);
  }, [skill.localPath, onOpenTerminal]);

  const body = skill.skillMdContent ? parseFrontmatter(skill.skillMdContent).body.trim() : '';
  const sourceLogo = resolveCatalogSourceIcon(skill.source);

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <SkillIconRenderer skill={skill} size="md" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-title tracking-title font-sans normal-case text-text">
              {skill.displayName}
            </DialogTitle>
            {skill.source !== 'local' && (
              <div className="mt-0.5 flex items-center gap-1.5 text-tiny tracking-tiny text-text-muted">
                {sourceLogo && (
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center text-text [&_svg]:h-full [&_svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: sourceLogo }}
                  />
                )}
                <span>From {SOURCE_LABELS[skill.source] ?? skill.source} skill library</span>
              </div>
            )}
          </div>
        </div>
      </DialogHeader>
      <DialogContentArea>
        {detailError && (
          <div className="flex items-center gap-2 rounded-md border border-status-err-border bg-status-err-bg px-3 py-2 text-tiny tracking-tiny text-status-err">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">
              Couldn&apos;t load the full skill details: {detailError.message}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="rounded border border-border px-2 py-0.5 text-text transition-colors hover:bg-status-err-bg-strong disabled:text-text-disabled"
            >
              Retry
            </button>
          </div>
        )}

        {skill.defaultPrompt && (
          <div className="space-y-1 rounded-md bg-surface-inset pb-2">
            <p className="text-tiny tracking-tiny font-medium text-text-muted">Example prompt</p>
            <pre className="whitespace-pre-wrap wrap-break-word text-code text-text">
              {skill.defaultPrompt}
            </pre>
          </div>
        )}

        {body && (
          <MarkdownRenderer
            content={body}
            variant="compact"
            className="max-h-60 overflow-y-auto rounded-md bg-surface-raised  py-2 text-body tracking-body text-text-muted"
          />
        )}
      </DialogContentArea>

      <DialogFooter className="gap-2 sm:gap-2">
        {skill.installed && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleUninstall()}
              disabled={isProcessing}
              className="text-status-err hover:text-status-err"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Uninstall
            </Button>
            {skill.localPath && onOpenTerminal && (
              <Button variant="outline" size="sm" onClick={handleOpen}>
                <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                Open
              </Button>
            )}
          </>
        )}
        {!skill.installed && (
          <ConfirmButton size="sm" onClick={() => void handleInstall()} disabled={isProcessing}>
            {isProcessing ? 'Installing...' : 'Install'}
          </ConfirmButton>
        )}
        <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}
