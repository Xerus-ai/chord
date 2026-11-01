import { Plus, Trash2 } from 'lucide-react';
import React from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';
import { FieldTooltip } from './FieldTooltip';

export type EnvEntry = { id: number; key: string; value: string };

/** POSIX-portable env var name. Anything else is rejected rather than silently dropped. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function findInvalidEnvKeys(entries: EnvEntry[]): string[] {
  return entries
    .map((entry) => entry.key.trim())
    .filter((key) => key.length > 0 && !ENV_KEY_PATTERN.test(key));
}

interface ProviderEnvVarEditorProps {
  entries: EnvEntry[];
  invalidKeys: string[];
  onChangeEntry: (id: number, update: Partial<EnvEntry>) => void;
  onRemoveEntry: (id: number) => void;
  onAddEntry: () => void;
}

export const ProviderEnvVarEditor: React.FC<ProviderEnvVarEditorProps> = ({
  entries,
  invalidKeys,
  onChangeEntry,
  onRemoveEntry,
  onAddEntry,
}) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Label className="text-body tracking-body font-medium">Environment variables</Label>
      <FieldTooltip content="Environment variables set when running the agent" />
    </div>
    <div className="space-y-2">
      {entries.map((entry) => {
        const trimmedKey = entry.key.trim();
        const isInvalid = trimmedKey.length > 0 && !ENV_KEY_PATTERN.test(trimmedKey);
        return (
          <div key={entry.id} className="flex items-center gap-2">
            <Input
              value={entry.key}
              onChange={(e) => onChangeEntry(entry.id, { key: e.target.value })}
              placeholder="KEY"
              aria-invalid={isInvalid}
              className={cn(
                'min-w-0 flex-1 font-mono text-code',
                isInvalid && 'border-status-err-border'
              )}
            />
            <Input
              value={entry.value}
              onChange={(e) => onChangeEntry(entry.id, { value: e.target.value })}
              placeholder="value"
              className="min-w-0 flex-1 font-mono text-code"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemoveEntry(entry.id)}
              className="h-8 w-8 shrink-0"
              aria-label="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      {invalidKeys.length > 0 && (
        <p className="text-tiny tracking-tiny text-status-err">
          Invalid variable {invalidKeys.length === 1 ? 'name' : 'names'}: {invalidKeys.join(', ')}.
          Use letters, digits and underscores, starting with a letter or underscore.
        </p>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onAddEntry} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" />
        Add variable
      </Button>
    </div>
  </div>
);
