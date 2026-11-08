import { useState } from 'react';
import type { ConfigLayer } from '@shared/repo-config';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';

const LAYER_LABELS: Record<ConfigLayer, string> = {
  team: 'Team file',
  justMe: 'Just me',
  default: 'Default',
};

const LAYER_TITLES: Record<ConfigLayer, string> = {
  team: "From the repository's .chord.json — shared with everyone who uses it.",
  justMe: 'Your own setting, on this machine only.',
  default: "Chord's built-in default.",
};

/** Where a value came from: the team file, this machine ("Just me"), or the default. */
export function LayerBadge({ layer }: { layer: ConfigLayer }) {
  return (
    <Badge variant="secondary" title={LAYER_TITLES[layer]}>
      {LAYER_LABELS[layer]}
    </Badge>
  );
}

/**
 * A repository setting with its provenance, edited in place. "Save for me"
 * writes this machine's value; "Save to team file" writes the main
 * checkout's `.chord.json` (uncommitted). A just-me value can be dropped so
 * the team's or the default applies again.
 */
export function LayeredField({
  title,
  description,
  value,
  layer,
  emptyLabel,
  multiline = false,
  onSaveJustMe,
  onSaveTeam,
}: {
  title: string;
  description: string;
  value: string | null;
  layer: ConfigLayer;
  /** Shown when nothing is set, e.g. "origin's default branch". */
  emptyLabel: string;
  multiline?: boolean;
  /** Omitted where the setting has no just-me layer. */
  onSaveJustMe?: (value: string | null) => Promise<boolean>;
  /**
   * Omitted where the setting has no team layer, or while a team write would
   * be refused (`teamFile.writeBlocked`). With neither save, there is no Edit.
   */
  onSaveTeam?: (value: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (write: (value: string | null) => Promise<boolean>, next: string | null) => {
    setBusy(true);
    try {
      if (await write(next)) setDraft(null);
    } finally {
      setBusy(false);
    }
  };
  const trimmed = draft?.trim() ? draft.trim() : null;
  const Editor = multiline ? Textarea : Input;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-body tracking-body text-text">{title}</span>
        <LayerBadge layer={layer} />
        <div className="ml-auto flex items-center gap-1">
          {draft === null && (onSaveJustMe || onSaveTeam) && (
            <Button variant="ghost" size="xs" onClick={() => setDraft(value ?? '')}>
              Edit
            </Button>
          )}
          {draft === null && layer === 'justMe' && onSaveJustMe && (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              title="Drop your own value so the team file's (or the default) applies"
              onClick={() => void save(onSaveJustMe, null)}
            >
              Use team value
            </Button>
          )}
        </div>
      </div>
      <p className="text-tiny tracking-tiny text-text-passive">{description}</p>

      {draft === null ? (
        value ? (
          <pre className="overflow-auto rounded-xs bg-surface-inset px-2 py-1.5 font-mono text-tiny tracking-tiny whitespace-pre-wrap text-text">
            {value}
          </pre>
        ) : (
          <p className="text-tiny tracking-tiny text-text-muted">{emptyLabel}</p>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <Editor
            value={draft}
            onChange={(event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
              setDraft(event.target.value)
            }
            aria-label={title}
            className="font-mono"
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            {onSaveJustMe && (
              <Button size="xs" disabled={busy} onClick={() => void save(onSaveJustMe, trimmed)}>
                Save for me
              </Button>
            )}
            {onSaveTeam && (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                title="Writes the main checkout's .chord.json; you commit it"
                onClick={() => void save(onSaveTeam, trimmed)}
              >
                Save to team file
              </Button>
            )}
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
