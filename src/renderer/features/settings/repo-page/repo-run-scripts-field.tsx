import { X } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_RUN_SCRIPT_ID, type RunScriptsValue } from '@shared/run-scripts';
import type { ResolvedRepoConfig } from '@main/core/repo-config/resolve-repo-config';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';
import { LayerBadge } from './layered-field';
import {
  addNamedRunScriptRow,
  buildRunScriptsValue,
  findRunScriptRowErrors,
  isSingleRunScript,
  listRunScriptRows,
  removeRunScriptRow,
  type RunScriptRow,
} from './run-script-rows';
import { describeScriptLayer } from './script-layer-note';

type SaveRunScripts = (value: RunScriptsValue | null) => Promise<boolean>;

/**
 * Repo › Run & test › Run scripts: one "Run" command, or named scripts (web,
 * api…) each started on its own. Saved like the other layered fields — for
 * this machine, or to the main checkout's `.chord.json` — and a just-me value
 * replaces the team's run scripts as a whole.
 */
export function RunScriptsField({
  run,
  onSaveJustMe,
  onSaveTeam,
}: {
  run: ResolvedRepoConfig['scripts']['run'];
  onSaveJustMe: SaveRunScripts;
  /** Omitted while a team write would be refused (`teamFile.writeBlocked`). */
  onSaveTeam?: SaveRunScripts;
}) {
  const [rows, setRows] = useState<RunScriptRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (write: SaveRunScripts, value: RunScriptsValue | null) => {
    setBusy(true);
    try {
      if (await write(value)) setRows(null);
    } finally {
      setBusy(false);
    }
  };

  const scripts = Object.entries(run.value);
  const layerNote = describeScriptLayer(run.layer, 'run');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-body tracking-body text-text">Run</span>
        <LayerBadge layer={run.layer} />
        <div className="ml-auto flex items-center gap-1">
          {rows === null && (
            <Button variant="ghost" size="xs" onClick={() => setRows(listRunScriptRows(run.value))}>
              Edit
            </Button>
          )}
          {rows === null && run.layer === 'justMe' && (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              title="Drop your own run scripts so the team file's (or none) apply"
              onClick={() => void save(onSaveJustMe, null)}
            >
              Use team value
            </Button>
          )}
        </div>
      </div>
      <p className="text-tiny tracking-tiny text-text-passive">
        Starts the app for a lane: one command, or named scripts that each start on their own.
        {layerNote && ` ${layerNote}`}
      </p>

      {rows === null ? (
        scripts.length === 0 ? (
          <p className="text-tiny tracking-tiny text-text-muted">None</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {scripts.map(([id, command]) => (
              <li key={id} className="flex flex-col gap-1">
                {id !== DEFAULT_RUN_SCRIPT_ID && (
                  <span className="font-mono text-tiny tracking-tiny text-text-muted">{id}</span>
                )}
                <pre className="overflow-auto rounded-xs bg-surface-inset px-2 py-1.5 font-mono text-tiny tracking-tiny whitespace-pre-wrap text-text">
                  {command}
                </pre>
              </li>
            ))}
          </ul>
        )
      ) : (
        <RunScriptsEditor
          rows={rows}
          busy={busy}
          onChange={setRows}
          onCancel={() => setRows(null)}
          onSaveJustMe={(value) => void save(onSaveJustMe, value)}
          onSaveTeam={onSaveTeam && ((value) => void save(onSaveTeam, value))}
        />
      )}
    </div>
  );
}

function RunScriptsEditor({
  rows,
  busy,
  onChange,
  onCancel,
  onSaveJustMe,
  onSaveTeam,
}: {
  rows: RunScriptRow[];
  busy: boolean;
  onChange: (rows: RunScriptRow[]) => void;
  onCancel: () => void;
  onSaveJustMe: (value: RunScriptsValue | null) => void;
  onSaveTeam?: (value: RunScriptsValue | null) => void;
}) {
  const errors = findRunScriptRowErrors(rows);
  const invalid = errors.some((error) => error.id !== null || error.command !== null);
  const single = isSingleRunScript(rows);
  const update = (index: number, patch: Partial<RunScriptRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-col gap-2">
      {single ? (
        <Textarea
          value={rows[0].command}
          onChange={(event) => update(0, { command: event.target.value })}
          aria-label="Run"
          className="font-mono"
          autoFocus
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={index} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  value={row.id}
                  onChange={(event) => update(index, { id: event.target.value })}
                  aria-label="Script name"
                  placeholder="web"
                  className="w-40 font-mono"
                />
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Remove ${row.id || 'this script'}`}
                  onClick={() => onChange(removeRunScriptRow(rows, index))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              {errors[index].id && (
                <p className="text-tiny tracking-tiny text-status-err">{errors[index].id}</p>
              )}
              <Textarea
                value={row.command}
                onChange={(event) => update(index, { command: event.target.value })}
                aria-label={`Command for ${row.id || 'this script'}`}
                className="font-mono"
              />
              {errors[index].command && (
                <p className="text-tiny tracking-tiny text-status-err">{errors[index].command}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="xs" variant="ghost" onClick={() => onChange(addNamedRunScriptRow(rows))}>
          Add named script
        </Button>
        <Button
          size="xs"
          disabled={busy || invalid}
          onClick={() => onSaveJustMe(buildRunScriptsValue(rows))}
        >
          Save for me
        </Button>
        {onSaveTeam && (
          <Button
            size="xs"
            variant="outline"
            disabled={busy || invalid}
            title="Writes the main checkout's .chord.json; you commit it"
            onClick={() => onSaveTeam(buildRunScriptsValue(rows))}
          >
            Save to team file
          </Button>
        )}
        <Button size="xs" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
