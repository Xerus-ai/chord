import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import React, { useCallback } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { describeLoadError, LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import SkillCard from './SkillCard';
import { useSkills } from './useSkills';

const SkillsView: React.FC = () => {
  const {
    isLoading,
    catalogError,
    reloadCatalog,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
    uninstall,
  } = useSkills();
  const showCreateSkillModal = useShowModal('createSkillModal');
  const showSkillDetailModal = useShowModal('skillDetailModal');

  const handleOpenTerminal = useCallback((skillPath: string) => {
    void rpc.app.openIn({ app: 'terminal', path: skillPath });
  }, []);

  const openDetail = useCallback(
    (skill: CatalogSkill) => {
      showSkillDetailModal({
        skill,
        onInstall: install,
        onUninstall: uninstall,
        onOpenTerminal: handleOpenTerminal,
      });
    },
    [showSkillDetailModal, install, uninstall, handleOpenTerminal]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (catalogError) {
    return (
      <LoadErrorNotice
        title="Couldn't load the skill catalog"
        message={describeLoadError(catalogError)}
        onRetry={() => void reloadCatalog()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          disabled={isRefreshing}
          aria-label="Refresh catalog"
        >
          <RefreshCw className={`h-4 w-4 text-text-muted ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
        <Button variant="outline" size="sm" onClick={() => showCreateSkillModal({})}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Skill
        </Button>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3">
        <p className="text-tiny tracking-tiny leading-relaxed text-text-muted">
          Skills from the{' '}
          <a
            href="https://github.com/openai/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text underline decoration-text-muted/40 underline-offset-2 hover:decoration-text"
          >
            OpenAI
          </a>{' '}
          and{' '}
          <a
            href="https://github.com/anthropics/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text underline decoration-text-muted/40 underline-offset-2 hover:decoration-text"
          >
            Anthropic
          </a>{' '}
          catalogs. Install a skill to make it available across all your coding agents. Skills
          follow the open{' '}
          <a
            href="https://agentskills.io"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-text underline decoration-text-muted/40 underline-offset-2 hover:decoration-text"
          >
            Agent Skills
          </a>{' '}
          standard. If you want to use skills from another library, feel free to let us know through
          the feedback modal.
        </p>
      </div>

      {installedSkills.length > 0 && (
        <div>
          <h3 className="mb-3 section-header">Installed</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {installedSkills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
            ))}
          </div>
        </div>
      )}

      {recommendedSkills.length > 0 && (
        <div>
          <h3 className="mb-3 section-header">Recommended</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {recommendedSkills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
            ))}
          </div>
        </div>
      )}

      {installedSkills.length === 0 && recommendedSkills.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-body tracking-body text-text-muted">
            {searchQuery ? 'No skills match your search.' : 'No skills available.'}
          </p>
        </div>
      )}
    </div>
  );
};

export default SkillsView;
