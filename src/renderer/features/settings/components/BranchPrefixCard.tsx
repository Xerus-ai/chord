import React from 'react';
import { sanitizeRefSegment } from '@shared/git-branch-name';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { SegmentedControl } from '@renderer/lib/ui/segmented-control';
import { ResetToDefaultButton } from './ResetToDefaultButton';

type BranchPrefixMode = 'username' | 'custom' | 'none';

const MODE_OPTIONS: readonly { value: BranchPrefixMode; label: string }[] = [
  { value: 'username', label: 'GitHub username' },
  { value: 'custom', label: 'Custom' },
  { value: 'none', label: 'None' },
];

/**
 * Settings › Git: what a new chord-named branch starts with. Main resolves it
 * (`resolve-branch-prefix.ts`); in username mode the login is stored the first
 * time it is known, so this card stores it as soon as the mode is chosen.
 */
const BranchPrefixCard: React.FC = () => {
  const {
    value: localProject,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('localProject');
  const { user: githubUser, isInitialized: githubKnown } = useGithubContext();

  if (!localProject) return null;
  const { branchPrefixMode: mode, branchPrefix, branchPrefixUsername } = localProject;
  const githubLogin = githubUser?.login ?? null;

  const chooseMode = (next: BranchPrefixMode) => {
    if (next === 'username' && !branchPrefixUsername && githubLogin) {
      update({ branchPrefixMode: next, branchPrefixUsername: githubLogin });
    } else {
      update({ branchPrefixMode: next });
    }
  };

  const prefix =
    mode === 'none'
      ? ''
      : mode === 'custom'
        ? sanitizeRefSegment(branchPrefix)
        : sanitizeRefSegment(branchPrefixUsername ?? githubLogin ?? '');
  // Username mode with no login yet has no example to give; UsernameStatus says why.
  const example = prefix
    ? `${prefix}/my-feature-a3f`
    : mode === 'username'
      ? null
      : 'my-feature-a3f';

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="xs"
            ariaLabel="Branch prefix"
            options={MODE_OPTIONS}
            value={mode}
            onChange={chooseMode}
          />
          <ResetToDefaultButton
            visible={isFieldOverridden('branchPrefixMode')}
            defaultLabel="GitHub username"
            onReset={() => resetField('branchPrefixMode')}
            disabled={loading || saving}
          />
        </div>

        {mode === 'username' && (
          <UsernameStatus
            stored={branchPrefixUsername}
            githubLogin={githubLogin}
            githubKnown={githubKnown}
            onUse={(login) => update({ branchPrefixUsername: login })}
            disabled={saving}
          />
        )}

        {mode === 'custom' && (
          <Input
            key={branchPrefix}
            defaultValue={branchPrefix}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== branchPrefix) update({ branchPrefix: next });
            }}
            placeholder="Branch prefix"
            aria-label="Custom branch prefix"
            disabled={loading}
          />
        )}

        {example && (
          <div className="text-tiny tracking-tiny text-text-muted">
            New branches look like <code className="rounded bg-surface-inset px-1">{example}</code>.
            Branches that already exist keep their names.
          </div>
        )}
      </div>
    </div>
  );
};

/** Which login username mode uses, and what to do when there is none or it changed. */
function UsernameStatus({
  stored,
  githubLogin,
  githubKnown,
  onUse,
  disabled,
}: {
  stored: string | null;
  githubLogin: string | null;
  githubKnown: boolean;
  onUse: (login: string) => void;
  disabled: boolean;
}) {
  const text = 'text-tiny tracking-tiny text-text-muted';
  if (stored && githubLogin && githubLogin !== stored) {
    return (
      <div className={`flex items-center gap-2 ${text}`}>
        <span>
          Uses <span className="font-mono text-text">{stored}</span>; GitHub is now signed in as{' '}
          <span className="font-mono text-text">{githubLogin}</span>.
        </span>
        <Button variant="ghost" size="xs" onClick={() => onUse(githubLogin)} disabled={disabled}>
          Use {githubLogin}
        </Button>
      </div>
    );
  }
  if (stored) {
    return (
      <div className={text}>
        Uses your GitHub username, <span className="font-mono text-text">{stored}</span>.
      </div>
    );
  }
  if (githubLogin) {
    return (
      <div className={text}>
        Will use your GitHub username, <span className="font-mono text-text">{githubLogin}</span>.
      </div>
    );
  }
  return (
    <div className={text}>
      {githubKnown
        ? "GitHub isn't connected, so new branches can't be named after you. Connect it in Settings › Integrations, or choose Custom or None."
        : 'Checking your GitHub account…'}
    </div>
  );
}

export default BranchPrefixCard;
