import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import type { JustMePatch, RepoJustMeSettings } from '@shared/repo-config';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { LayerBadge } from './layered-field';
import { describeCompanionRefusal, suggestAppFolder } from './repo-companion-model';

type Companion = NonNullable<RepoJustMeSettings['companionRepo']>;

/**
 * Repo › General › Companion repository (devstation-4x42.243): the repository
 * that contains this one on this machine. New lanes get the companion's own
 * worktree with their checkout nested at the folder named here, and their
 * sessions start at the companion's root. Just me only: the companion is the
 * user's, its path personal. A refusal is shown in place.
 */
export function RepoCompanionRow({
  repoAlias,
  repoPath,
  companion,
  save,
}: {
  repoAlias: string;
  repoPath: string;
  companion: Companion | undefined;
  /** Resolves null once saved, else why not (`saveJustMeReporting`). */
  save: (patch: JustMePatch) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<Companion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const write = async (value: Companion | null) => {
    setBusy(true);
    try {
      const refused = await save({ companionRepo: value });
      setError(refused === null ? null : describeCompanionRefusal(refused));
      if (refused === null) setDraft(null);
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const selected = await rpc.app.openSelectDirectoryDialog({
      title: `Companion repository of ${repoAlias}`,
      message: `Choose the main checkout of the repository ${repoAlias} sits in`,
    });
    if (!selected) return;
    setError(null);
    setDraft({
      path: selected,
      appFolder: suggestAppFolder(selected, repoPath) ?? draft?.appFolder ?? '',
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="repo-companion-row">
      <div className="flex items-center gap-2">
        <span className="text-body tracking-body text-text">Companion repository</span>
        <LayerBadge layer={companion ? 'justMe' : 'default'} />
        <div className="ml-auto flex items-center gap-1">
          {companion && draft === null && (
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => void write(null)}>
              Remove
            </Button>
          )}
          <Button variant="outline" size="xs" disabled={busy} onClick={() => void choose()}>
            <FolderOpen className="h-3.5 w-3.5" />
            Choose…
          </Button>
        </div>
      </div>
      <p className="text-tiny tracking-tiny text-text-passive">
        The repository that contains {repoAlias} on this machine. New lanes also get a worktree of
        it, with their checkout inside, and their agents start at its root.
      </p>

      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-tiny tracking-tiny text-text">{draft.path}</span>
          <label className="flex items-center gap-2 text-tiny tracking-tiny text-text-muted">
            Folder of {repoAlias} inside it
            <Input
              value={draft.appFolder}
              onChange={(event) => setDraft({ ...draft, appFolder: event.target.value })}
              aria-label={`Folder of ${repoAlias} inside the companion repository`}
              aria-invalid={error !== null}
              className="w-56 font-mono"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button size="xs" disabled={busy} onClick={() => void write(draft)}>
              Save for me
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : companion ? (
        <pre className="overflow-auto rounded-xs bg-surface-inset px-2 py-1.5 font-mono text-tiny tracking-tiny whitespace-pre-wrap text-text">
          {companion.path}
          {'\n'}
          {repoAlias} at {companion.appFolder}
        </pre>
      ) : (
        <p className="text-tiny tracking-tiny text-text-muted">None</p>
      )}
      {error !== null && (
        <p role="alert" className="text-tiny tracking-tiny text-status-err">
          {error}
        </p>
      )}
    </div>
  );
}
