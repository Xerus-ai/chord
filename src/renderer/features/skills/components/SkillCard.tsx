import { Pencil, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import React from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import SkillIconRenderer from './SkillIconRenderer';

interface SkillCardProps {
  skill: CatalogSkill;
  onSelect: (skill: CatalogSkill) => void;
  onInstall: (skillId: string) => void;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, onSelect, onInstall }) => {
  return (
    <motion.div
      role="button"
      tabIndex={0}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={() => onSelect(skill)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(skill);
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left text-text shadow-sm transition-[background-color,border-color,box-shadow] duration-100 hover:bg-surface-inset hover:shadow-md"
    >
      <SkillIconRenderer skill={skill} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-title tracking-title font-semibold">{skill.displayName}</h3>
        <p className="mt-0.5 line-clamp-1 text-tiny tracking-tiny text-text-muted">
          {skill.description}
        </p>
      </div>

      {/* Action */}
      <div className="shrink-0 self-center">
        {skill.installed ? (
          <Pencil className="h-4 w-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onInstall(skill.id);
            }}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-inset hover:text-text"
            aria-label={`Install ${skill.displayName}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default SkillCard;
