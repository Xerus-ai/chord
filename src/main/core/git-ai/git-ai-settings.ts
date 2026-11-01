import {
  GIT_AI_FIELDS,
  readGitAiField,
  type GitAiField,
  type GitAiLayer,
  type GitAiOverride,
  type GitAiSettings,
  type ResolvedGitAiSettings,
} from '@shared/git-ai';
import { readJustMeSettings } from '@main/core/repo-config/resolve-repo-config';
import { getDefaultForKey } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { isDeepEqual } from '@main/core/settings/utils';

function applyOverride(you: GitAiSettings, override: GitAiOverride): GitAiSettings {
  return {
    agent: override.agent ?? you.agent,
    model: override.model === undefined ? you.model : override.model,
    instructions: { ...you.instructions, ...override.instructions },
    prDefaults: { ...you.prDefaults, ...override.prDefaults },
  };
}

function layerOf(
  field: GitAiField,
  defaults: GitAiSettings,
  you: GitAiSettings,
  override: GitAiOverride
): GitAiLayer {
  if (readGitAiField(override, field) !== undefined) return 'justMe';
  return isDeepEqual(readGitAiField(you, field), readGitAiField(defaults, field))
    ? 'default'
    : 'you';
}

/**
 * Settings › Git › AI for work in `repoId` (null: no repository), per field:
 * built-in < You < the repository's just-me override. Each field says which
 * layer it came from.
 */
export async function readGitAiSettings(repoId: string | null): Promise<ResolvedGitAiSettings> {
  const defaults = getDefaultForKey('gitAi');
  const you = await appSettingsService.get('gitAi');
  const override = readJustMeSettings(repoId).gitAi ?? {};
  const layers = Object.fromEntries(
    GIT_AI_FIELDS.map((field) => [field, layerOf(field, defaults, you, override)])
  ) as Record<GitAiField, GitAiLayer>;
  return { value: applyOverride(you, override), layers };
}
