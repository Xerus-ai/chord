import { Check, FolderOpen } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { OnboardingSection, RowTile, SectionFooter, SectionRow } from './onboarding-section';

interface RepoInfo {
  path: string;
  alias: string;
}

const folderTile = (
  <RowTile>
    <FolderOpen className="size-icon-md" strokeWidth={1.5} />
  </RowTile>
);

/**
 * Attaches local git repositories, and reports the step done once there is at
 * least one — including repositories that were already attached before this
 * run. Held as bare `useState([])`, the step ignored them entirely: a second
 * account on a shared machine, or a reinstall that kept the local database, was
 * told to add a repository it could already see listed in Settings.
 */
export function OnboardingRepoSection({
  index,
  isNext,
  onDone,
}: {
  index: number;
  isNext: boolean;
  onDone: () => void;
}) {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (repos.length > 0) onDone();
  }, [repos.length, onDone]);

  useEffect(() => {
    let cancelled = false;

    // Default args exclude archived repositories, which is what this step
    // means: an archived repo is not one you can start work in.
    rpc.repos.getAll().then(
      (result) => {
        if (cancelled) return;
        if (!result.success) {
          setError('Could not read the repositories already added to Chord.');
          return;
        }
        setRepos(result.data.repos.map((repo) => ({ path: repo.path, alias: repo.alias })));
      },
      (fetchError: unknown) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const handleBrowseRepo = useCallback(async () => {
    setError(null);
    try {
      const selectedPath = await rpc.app.openSelectDirectoryDialog({
        title: 'Select repository folder',
        message: 'Choose a local project folder to add to Chord',
      });
      if (!selectedPath) return;
      const segments = selectedPath.replace(/\\/g, '/').split('/');
      const alias = segments[segments.length - 1] ?? 'repo';
      const result = await rpc.repos.create({ path: selectedPath, alias });
      if (!result.success) {
        setError(`${result.error.path} is not a git repository.`);
        return;
      }
      setRepos((prev) =>
        prev.some((r) => r.path === selectedPath) ? prev : [...prev, { path: selectedPath, alias }]
      );
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  }, []);

  const browse = (
    <Button variant="outline" size="xs" onClick={() => void handleBrowseRepo()}>
      <FolderOpen />
      Browse…
    </Button>
  );

  return (
    <OnboardingSection
      index={index}
      isNext={isNext}
      title="Add a repository"
      meta={{ kind: 'estimate', label: '1 min' }}
      description="Each work item gets its own branch and worktree inside it."
      state={error ? 'error' : repos.length > 0 ? 'done' : 'todo'}
      answer={
        repos.length > 0 && (
          <>
            <span className="font-medium text-text-muted">{repos[0].alias}</span>
            {repos.length > 1 && ` +${repos.length - 1}`}
          </>
        )
      }
      footer={error && <SectionFooter tone="error">{error}</SectionFooter>}
    >
      {repos.map((repo) => (
        <SectionRow
          key={repo.path}
          leading={folderTile}
          label={repo.alias}
          detail={repo.path}
          detailMono
          control={<Check className="size-icon-sm text-status-ok" strokeWidth={2.5} />}
        />
      ))}
      {repos.length > 0 ? (
        <SectionRow
          label={<span className="font-normal text-text-passive">Add another repository</span>}
          control={browse}
          className="min-h-12"
        />
      ) : (
        <SectionRow
          leading={folderTile}
          label="Project folder"
          detail="Any local git repository."
          control={browse}
        />
      )}
    </OnboardingSection>
  );
}
