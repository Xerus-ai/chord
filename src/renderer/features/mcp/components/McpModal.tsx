import { useForm } from '@tanstack/react-form';
import { Trash2 } from 'lucide-react';
import React, { useRef, useState } from 'react';
import type { McpProvidersResponse, McpServer } from '@shared/mcp/types';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { KeyValueSection, type KVEntry } from './KeyValueSection';
import {
  findMissingCredentials,
  getCatalogEntry,
  getInitialState,
  type McpModalMode,
} from './mcp-modal-state';
import { ProviderSelect } from './ProviderSelect';

interface McpModalProps extends BaseModalProps {
  mode: McpModalMode;
  providers: McpProvidersResponse[];
  onSave: (server: McpServer) => Promise<void>;
  onRemove?: (serverName: string) => void;
}

export const McpModal: React.FC<McpModalProps> = ({
  mode,
  providers,
  onSave,
  onRemove,
  onSuccess,
}) => {
  const isEdit = mode.type === 'edit';
  const isCatalog = mode.type === 'add-catalog';
  const catalogEntry = getCatalogEntry(mode);
  const credentialKeys = new Map(
    catalogEntry?.credentialKeys.map((c) => [c.key, c.required] as const) ?? []
  );

  const nextId = useRef(0);
  const makeId = () => nextId.current++;

  const toKV = (entries: [string, string][]): KVEntry[] =>
    entries.map(([k, v]) => ({ id: makeId(), key: k, value: v }));

  const requiredCredentialKeys =
    catalogEntry?.credentialKeys.filter((c) => c.required).map((c) => c.key) ?? [];

  const initial = getInitialState(mode);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: initial.name,
      transport: initial.transport,
      command: initial.command,
      args: initial.args,
      url: initial.url,
      envEntries: toKV(initial.env),
      headerEntries: toKV(initial.headers),
      selectedProviders: initial.providers,
    },
  });

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const v = form.state.values;
      const filledHeaders = v.headerEntries.filter((e) => e.key && e.value);
      const filledEnv = v.envEntries.filter((e) => e.key && e.value);
      const server: McpServer = {
        name: v.name,
        transport: v.transport,
        command: v.transport === 'stdio' ? v.command : undefined,
        args:
          v.transport === 'stdio' && v.args.trim()
            ? v.args.split('\n').filter((a) => a.length > 0)
            : undefined,
        url: v.transport === 'http' ? v.url : undefined,
        headers: filledHeaders.length
          ? Object.fromEntries(filledHeaders.map((e) => [e.key, e.value]))
          : undefined,
        env: filledEnv.length
          ? Object.fromEntries(filledEnv.map((e) => [e.key, e.value]))
          : undefined,
        providers: v.selectedProviders,
      };
      await onSave(server);
      onSuccess(server);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit
            ? 'Edit MCP Server'
            : isCatalog
              ? `Add ${form.state.values.name}`
              : 'Add Custom MCP Server'}
        </DialogTitle>
      </DialogHeader>

      <DialogContentArea>
        {isCatalog && mode.entry.description && (
          <p className="text-tiny tracking-tiny text-text-muted">{mode.entry.description}</p>
        )}
        <FieldGroup>
          {/* Name */}
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel>Server Name</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={isCatalog || isEdit}
                  placeholder="my-server"
                />
              </Field>
            )}
          </form.Field>

          {/* Transport */}
          {!isCatalog && (
            <form.Field name="transport">
              {(field) => (
                <Field>
                  <FieldLabel>Transport</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(v) => {
                      const next = v as 'stdio' | 'http';
                      field.handleChange(next);
                      if (next === 'http') {
                        form.setFieldValue('selectedProviders', (prev) => {
                          return prev.filter((id) => {
                            const provider = providers.find((p) => p.id === id);
                            return provider?.supportsHttp ?? true;
                          });
                        });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdio">stdio</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
          )}

          {/* Transport-specific fields */}
          <form.Subscribe selector={(state) => state.values.transport}>
            {(transport) => (
              <>
                {transport === 'stdio' && (
                  <>
                    <form.Field name="command">
                      {(field) => (
                        <Field>
                          <FieldLabel>Command</FieldLabel>
                          <Input
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={isCatalog}
                            placeholder="npx"
                          />
                        </Field>
                      )}
                    </form.Field>
                    <form.Field name="args">
                      {(field) => (
                        <Field>
                          <FieldLabel>Arguments (one per line)</FieldLabel>
                          <textarea
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={isCatalog}
                            placeholder={'-y\nmy-mcp-server'}
                            rows={3}
                            className="flex w-full rounded-md border border-border bg-surface px-3 py-2 text-body tracking-body ring-offset-surface placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-border focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
                          />
                        </Field>
                      )}
                    </form.Field>
                  </>
                )}

                {transport === 'http' && (
                  <form.Field name="url">
                    {(field) => (
                      <Field>
                        <FieldLabel>URL</FieldLabel>
                        <Input
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          disabled={isCatalog}
                          placeholder="https://mcp.example.com"
                        />
                      </Field>
                    )}
                  </form.Field>
                )}
              </>
            )}
          </form.Subscribe>

          {/* Env vars — both transports */}
          <form.Field name="envEntries">
            {(field) => (
              <KeyValueSection
                label="Environment Variables"
                entries={field.state.value}
                onChange={(entries) => field.handleChange(entries)}
                addLabel="+ Add env var"
                makeId={makeId}
                credentialKeys={credentialKeys}
              />
            )}
          </form.Field>

          {/* Headers — http only */}
          <form.Subscribe selector={(state) => state.values.transport}>
            {(transport) =>
              transport === 'http' && (
                <form.Field name="headerEntries">
                  {(field) => (
                    <KeyValueSection
                      label="Headers"
                      entries={field.state.value}
                      onChange={(entries) => field.handleChange(entries)}
                      addLabel="+ Add header"
                      makeId={makeId}
                      credentialKeys={credentialKeys}
                    />
                  )}
                </form.Field>
              )
            }
          </form.Subscribe>

          {/* Providers */}
          <form.Field name="selectedProviders">
            {(field) => (
              <form.Subscribe selector={(state) => state.values.transport}>
                {(transport) => (
                  <ProviderSelect
                    providers={providers}
                    selectedProviders={field.state.value}
                    transport={transport}
                    onToggle={(id) => {
                      field.handleChange(
                        field.state.value.includes(id)
                          ? field.state.value.filter((value) => value !== id)
                          : [...field.state.value, id]
                      );
                    }}
                  />
                )}
              </form.Subscribe>
            )}
          </form.Field>
        </FieldGroup>

        {saveError && (
          <div className="rounded-md border border-status-err-border bg-status-err-bg px-3 py-2 text-tiny tracking-tiny text-status-err">
            Couldn&apos;t save this server: {saveError}
          </div>
        )}
      </DialogContentArea>

      {/* Actions */}
      <DialogFooter className="gap-2 sm:gap-2">
        {isEdit && onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-status-err hover:text-status-err"
            onClick={() => onRemove(form.state.values.name)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remove
          </Button>
        )}
        <form.Subscribe selector={(state) => state.values}>
          {(values) => {
            const missingCredentials = findMissingCredentials(requiredCredentialKeys, [
              ...values.envEntries,
              ...values.headerEntries,
            ]);
            const canSave =
              !!values.name.trim() &&
              !saving &&
              values.selectedProviders.length > 0 &&
              missingCredentials.length === 0 &&
              !!(values.transport === 'http' ? values.url.trim() : values.command.trim());
            return (
              <div className="flex flex-1 items-center justify-end gap-3">
                {missingCredentials.length > 0 && (
                  <p className="text-tiny tracking-tiny text-status-err">
                    Fill in required{' '}
                    {missingCredentials.length === 1 ? 'credential' : 'credentials'}:{' '}
                    {missingCredentials.join(', ')}
                  </p>
                )}
                <ConfirmButton
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!canSave}
                  size="sm"
                >
                  {saving ? (isEdit ? 'Saving...' : 'Adding...') : isEdit ? 'Save' : 'Add'}
                </ConfirmButton>
              </div>
            );
          }}
        </form.Subscribe>
      </DialogFooter>
    </>
  );
};
