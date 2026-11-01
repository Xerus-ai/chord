import { ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { listTrustItems } from './trust-items';
import type { useRepoSettings } from './use-repo-settings';

type Repo = ReturnType<typeof useRepoSettings>;

/**
 * Repo › Trust: what a new lane would run, what Always trust covers (and what
 * changed since), and the two ways to take trust away. Granting it is never
 * done here: main's own window asks when a script is about to run.
 */
export function RepoTrustSection({ repo }: { repo: Repo }) {
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const { data, error } = repo.trust;
  if (error) return <p className="text-tiny tracking-tiny text-status-err">{error.message}</p>;
  if (!data) return <p className="text-tiny tracking-tiny text-text-passive">Loading…</p>;

  const trusted = data.alwaysTrusted;
  const items = listTrustItems(data.current, trusted?.content ?? null);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setConfirmRevoke(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-border-subtle px-3 py-2">
        {trusted ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-ok" />
        ) : (
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-text-passive" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body tracking-body text-text">
            Always trust is {trusted ? 'on' : 'off'}
          </span>
          <span className="text-tiny tracking-tiny text-text-passive">
            {trusted
              ? `Given ${new Date(trusted.decidedAt * 1000).toLocaleString()} for ${trusted.remoteUrl ?? 'a repository with no remote'}. ${
                  !data.alwaysTrustedRemoteMatches
                    ? 'The repository now fetches from somewhere else, so it no longer applies.'
                    : data.alwaysTrustedMatchesCurrent
                      ? 'It covers what a new lane would run now.'
                      : 'What a new lane would run has changed since, so the next one asks.'
                }`
              : "Each lane asks before running this repository's scripts. To turn it on, tick Always trust in that prompt."}
          </span>
          <span className="text-tiny tracking-tiny text-text-passive">
            {data.approvedLaneCount === 0
              ? 'No lane has an approval of its own.'
              : `${data.approvedLaneCount} lane${data.approvedLaneCount === 1 ? ' has its' : 's have their'} own approval.`}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {trusted && (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => void act(repo.turnOffAlwaysTrust)}
            >
              Turn off Always trust
            </Button>
          )}
          {confirmRevoke ? (
            <div className="flex items-center gap-1">
              <Button size="xs" disabled={busy} onClick={() => void act(repo.revokeTrust)}>
                Revoke all
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirmRevoke(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="xs"
              disabled={busy || (!trusted && data.approvedLaneCount === 0)}
              title="Removes Always trust and every lane's approval: each lane asks again before its next script"
              onClick={() => setConfirmRevoke(true)}
            >
              Revoke…
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-body tracking-body text-text">What a new lane would run</span>
        <span className="text-tiny tracking-tiny text-text-passive">
          From <code className="font-mono">.chord.json</code> and the Claude config committed at{' '}
          <code className="font-mono">{data.baseRef ?? '(no base)'}</code>
          {trusted ? ', compared with what Always trust approved.' : '.'}
        </span>
      </div>
      {data.currentError && (
        <p className="text-tiny tracking-tiny text-status-err">{data.currentError}</p>
      )}
      {items.length === 0 && !data.currentError ? (
        <p className="text-tiny tracking-tiny text-text-muted">
          Nothing: this repository supplies no scripts or Claude config that runs code.
        </p>
      ) : (
        items.map((item) => (
          <section key={item.key} className="flex flex-col gap-1">
            <span className="text-body tracking-body text-text">
              {item.title}
              {item.changed && (
                <span className="text-status-warn">
                  {item.now === undefined ? ' — no longer runs' : ' — changed'}
                </span>
              )}
            </span>
            <span className="text-tiny tracking-tiny text-text-passive">{item.when}</span>
            {item.before !== undefined && (
              <pre className="overflow-auto rounded-xs bg-status-err-bg px-2 py-1.5 font-mono text-tiny tracking-tiny whitespace-pre-wrap text-status-err">
                {item.before}
              </pre>
            )}
            {item.now !== undefined && (
              <pre
                className={cn(
                  'overflow-auto rounded-xs px-2 py-1.5 font-mono text-tiny tracking-tiny whitespace-pre-wrap',
                  item.changed ? 'bg-status-ok-bg text-status-ok' : 'bg-surface-inset text-text'
                )}
              >
                {item.now}
              </pre>
            )}
          </section>
        ))
      )}
    </div>
  );
}
