import { LayeredField } from './layered-field';
import type { RepoSettingsData, useRepoSettings } from './use-repo-settings';

type Writes = Pick<ReturnType<typeof useRepoSettings>, 'saveTeam'>;

/**
 * Repo › Files to copy: gitignored files (`.env` and the like) copied from
 * the main checkout into each new lane. A team setting only; one pattern per
 * line. An empty list writes `[]` — copying nothing is a choice, not "unset".
 */
export function RepoFilesSection({ data, writes }: { data: RepoSettingsData; writes: Writes }) {
  const { config } = data;
  if (!config) return null;

  const toPatterns = (value: string | null): string[] =>
    (value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  return (
    <LayeredField
      title="Files to copy"
      description="Gitignored files copied from the main checkout into each new lane, one pattern per line. Tracked files are never copied, and a lane's copy stops at 500 MB or 20,000 files."
      value={config.filesToCopy.value.join('\n')}
      layer={config.filesToCopy.layer}
      emptyLabel="Nothing is copied"
      multiline
      onSaveTeam={
        data.teamFile.writeBlocked === null
          ? (value) => writes.saveTeam({ filesToCopy: toPatterns(value) })
          : undefined
      }
    />
  );
}
