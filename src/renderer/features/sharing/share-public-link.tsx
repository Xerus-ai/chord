import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import type { GeneralAccess, MemberRole, SharingState } from './sharing-api';

/**
 * Publish tab › Public link (shared-items design D2): for people outside the
 * team, view-only, and only while the team allows it. Turning it off makes
 * the artifact private to the people invited.
 */
export function SharePublicLink({
  state,
  onChange,
  onLinkCommentsChange,
}: {
  state: SharingState;
  onChange: (access: GeneralAccess, role: MemberRole) => Promise<void>;
  onLinkCommentsChange: (enabled: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const on = state.general_access === 'link';

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  if (!state.team_allows_public_links && !on) {
    return (
      <p className="text-tiny tracking-tiny text-text-passive" data-testid="publish-link">
        Your team doesn&apos;t allow public links.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="publish-link">
      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-body tracking-body text-text">Public link</span>
          <span className="text-tiny tracking-tiny text-text-passive">
            Anyone with the link can view it in a browser, no sign-in needed
          </span>
        </span>
        <Switch
          aria-label="Public link"
          checked={on}
          disabled={busy}
          onCheckedChange={(next) =>
            void run(() => (next ? onChange('link', 'view') : onChange('invited', 'view')))
          }
        />
      </label>

      {on && !state.team_allows_public_links && (
        <p className="text-tiny tracking-tiny text-status-warn">
          Your team has turned off public links, so this link does not open right now.
        </p>
      )}

      {state.link && (
        <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-raised p-3">
          <div className="flex items-center gap-2">
            <span className="flex-1 truncate font-mono text-tiny tracking-tiny text-text-passive">
              {state.link.url}
            </span>
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                void navigator.clipboard.writeText(state.link!.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
              }
            >
              <Link2 />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-tiny tracking-tiny text-text-muted">
              People signed in to Chord can comment
            </span>
            <Switch
              checked={state.link.comments_enabled}
              disabled={busy}
              onCheckedChange={(enabled) => void run(() => onLinkCommentsChange(enabled))}
            />
          </label>
        </div>
      )}
    </div>
  );
}
