import { RotateCcw } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type AgentProviderDefinition } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { useProviderSettings } from '@renderer/features/settings/use-provider-settings';
import { describeLoadError, LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { DialogContentArea, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { log } from '@renderer/utils/logger';
import { FieldTooltip } from './FieldTooltip';
import { findInvalidEnvKeys, ProviderEnvVarEditor, type EnvEntry } from './ProviderEnvVarEditor';

export interface CustomCommandModalProps extends BaseModalProps<void> {
  providerId: string;
}

type FormState = {
  cli: string;
  resumeFlag: string;
  defaultArgs: string;
  extraArgs: string;
  autoApproveFlag: string;
  initialPromptFlag: string;
  envEntries: EnvEntry[];
};

const getDefaultFromProvider = (provider: AgentProviderDefinition | undefined): FormState => ({
  cli: provider?.cli ?? '',
  resumeFlag: provider?.resumeFlag ?? '',
  defaultArgs: provider?.defaultArgs?.join(' ') ?? '',
  extraArgs: '',
  autoApproveFlag: provider?.autoApproveFlag ?? '',
  initialPromptFlag: provider?.initialPromptFlag ?? '',
  envEntries: [],
});

const configToFormState = (
  config: ProviderCustomConfig,
  fallback: FormState,
  makeId: () => number
): FormState => ({
  cli: config.cli ?? fallback.cli,
  resumeFlag: config.resumeFlag ?? fallback.resumeFlag,
  defaultArgs: Array.isArray(config.defaultArgs)
    ? config.defaultArgs.join(' ')
    : (config.defaultArgs ?? fallback.defaultArgs),
  extraArgs: config.extraArgs ?? '',
  autoApproveFlag: config.autoApproveFlag ?? fallback.autoApproveFlag,
  initialPromptFlag: config.initialPromptFlag ?? fallback.initialPromptFlag,
  envEntries: config.env
    ? Object.entries(config.env).map(([key, value]) => ({ id: makeId(), key, value }))
    : [],
});

export const CustomCommandModal: React.FC<CustomCommandModalProps> = ({
  providerId,
  onSuccess,
  onClose,
}) => {
  const provider = useMemo(() => AGENT_PROVIDERS.find((p) => p.id === providerId), [providerId]);
  const registryDefaults = useMemo(() => getDefaultFromProvider(provider), [provider]);

  const {
    value: storedConfig,
    isOverridden,
    isLoading,
    loadError,
    reloadSettings,
    update,
    reset,
  } = useProviderSettings(providerId);

  const [form, setForm] = useState<FormState>(registryDefaults);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const nextEnvId = useRef(0);
  const makeEnvId = useCallback(() => nextEnvId.current++, []);

  useEffect(() => {
    if (isLoading || loadError) return;
    if (storedConfig && isOverridden) {
      setForm(configToFormState(storedConfig, registryDefaults, makeEnvId));
    } else {
      setForm(registryDefaults);
    }
  }, [isLoading, loadError, storedConfig, isOverridden, registryDefaults, makeEnvId]);

  const handleChange = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setEnvEntry = useCallback((id: number, entryUpdate: Partial<EnvEntry>) => {
    setForm((prev) => ({
      ...prev,
      envEntries: prev.envEntries.map((entry) =>
        entry.id === id ? { ...entry, ...entryUpdate } : entry
      ),
    }));
  }, []);

  const addEnvEntry = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      envEntries: [...prev.envEntries, { id: makeEnvId(), key: '', value: '' }],
    }));
  }, [makeEnvId]);

  const removeEnvEntry = useCallback((id: number) => {
    setForm((prev) => ({
      ...prev,
      envEntries: prev.envEntries.filter((entry) => entry.id !== id),
    }));
  }, []);

  const invalidEnvKeys = useMemo(() => findInvalidEnvKeys(form.envEntries), [form.envEntries]);

  const handleResetToDefaults = useCallback(() => {
    setForm(registryDefaults);
  }, [registryDefaults]);

  const handleSave = useCallback(async () => {
    if (invalidEnvKeys.length > 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const envRecord: Record<string, string> = {};
      for (const { key, value } of form.envEntries) {
        const k = key.trim();
        if (k) envRecord[k] = value;
      }

      const isAtDefaults =
        form.cli === registryDefaults.cli &&
        form.resumeFlag === registryDefaults.resumeFlag &&
        form.defaultArgs === registryDefaults.defaultArgs &&
        form.extraArgs === '' &&
        form.autoApproveFlag === registryDefaults.autoApproveFlag &&
        form.initialPromptFlag === registryDefaults.initialPromptFlag &&
        form.envEntries.every((e) => !e.key.trim());

      if (isAtDefaults) {
        await new Promise<void>((resolve, reject) =>
          reset(undefined, { onSuccess: resolve, onError: reject })
        );
      } else {
        const config: ProviderCustomConfig = {
          cli: form.cli,
          resumeFlag: form.resumeFlag,
          defaultArgs: form.defaultArgs.trim() ? form.defaultArgs.trim().split(/\s+/) : undefined,
          extraArgs: form.extraArgs.trim() || undefined,
          autoApproveFlag: form.autoApproveFlag,
          initialPromptFlag: form.initialPromptFlag,
          env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        };
        await new Promise<void>((resolve, reject) =>
          update(config, { onSuccess: resolve, onError: reject })
        );
      }
      onSuccess();
    } catch (error) {
      log.error('Failed to save provider custom config:', error);
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [form, registryDefaults, reset, update, onSuccess, invalidEnvKeys]);

  const previewCommand = useMemo(() => {
    const parts: string[] = [];
    if (form.cli) parts.push(form.cli);
    if (form.resumeFlag) parts.push(form.resumeFlag);
    if (form.defaultArgs) parts.push(form.defaultArgs);
    if (form.extraArgs) parts.push(form.extraArgs);
    if (form.autoApproveFlag) parts.push(form.autoApproveFlag);
    if (form.initialPromptFlag) parts.push(form.initialPromptFlag);
    parts.push('{prompt}');
    return parts.join(' ');
  }, [form]);

  const hasChanges = useMemo(() => {
    if (isOverridden) return true;
    const hasEnv = form.envEntries.some((e) => e.key.trim() !== '');
    return (
      form.cli !== registryDefaults.cli ||
      form.resumeFlag !== registryDefaults.resumeFlag ||
      form.defaultArgs !== registryDefaults.defaultArgs ||
      form.extraArgs !== '' ||
      form.autoApproveFlag !== registryDefaults.autoApproveFlag ||
      form.initialPromptFlag !== registryDefaults.initialPromptFlag ||
      hasEnv
    );
  }, [form, registryDefaults, isOverridden]);

  if (!provider) return null;

  return (
    <>
      <DialogHeader className="flex-row items-start gap-4">
        <div>
          <DialogTitle className="text-title tracking-title font-semibold">
            {provider.name} Execution Settings
          </DialogTitle>
        </div>
      </DialogHeader>

      <DialogContentArea className="max-h-[65vh] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="text-body tracking-body text-text-muted">Loading...</div>
          </div>
        ) : loadError ? (
          <LoadErrorNotice
            title="Couldn't load these execution settings"
            message={describeLoadError(loadError)}
            onRetry={() => void reloadSettings()}
          />
        ) : (
          <div className="space-y-4">
            {/* CLI Command */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="cli" className="text-body tracking-body font-medium">
                  CLI Command
                </Label>
                <FieldTooltip content="The CLI command to execute (e.g., claude, codex)" />
              </div>
              <Input
                id="cli"
                value={form.cli}
                onChange={(e) => handleChange('cli', e.target.value)}
                placeholder={registryDefaults.cli || 'CLI command'}
                className="font-mono text-code"
              />
            </div>

            {/* Resume Flag */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="resumeFlag" className="text-body tracking-body font-medium">
                  Resume Flag
                </Label>
                <FieldTooltip content="Flag used when resuming a session (e.g., -c -r)" />
              </div>
              <Input
                id="resumeFlag"
                value={form.resumeFlag}
                onChange={(e) => handleChange('resumeFlag', e.target.value)}
                placeholder={registryDefaults.resumeFlag || '(none)'}
                className="font-mono text-code"
              />
            </div>

            {/* Default Args */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="defaultArgs" className="text-body tracking-body font-medium">
                  Default Args
                </Label>
                <FieldTooltip content="Default arguments (e.g., run -s)" />
              </div>
              <Input
                id="defaultArgs"
                value={form.defaultArgs}
                onChange={(e) => handleChange('defaultArgs', e.target.value)}
                placeholder={registryDefaults.defaultArgs || '(none)'}
                className="font-mono text-code"
              />
            </div>

            {/* Additional parameters */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="extraArgs" className="text-body tracking-body font-medium">
                  Additional parameters
                </Label>
                <FieldTooltip content="Extra flags appended to the command (e.g. --enable-all-github-mcp-tools)" />
              </div>
              <Input
                id="extraArgs"
                value={form.extraArgs}
                onChange={(e) => handleChange('extraArgs', e.target.value)}
                placeholder="e.g. --enable-all-github-mcp-tools"
                className="font-mono text-code"
              />
            </div>

            <ProviderEnvVarEditor
              entries={form.envEntries}
              invalidKeys={invalidEnvKeys}
              onChangeEntry={setEnvEntry}
              onRemoveEntry={removeEnvEntry}
              onAddEntry={addEnvEntry}
            />

            {/* Auto-approve Flag */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="autoApproveFlag" className="text-body tracking-body font-medium">
                  Auto-approve Flag
                </Label>
                <FieldTooltip content="Flag used in auto-approve mode" />
              </div>
              <Input
                id="autoApproveFlag"
                value={form.autoApproveFlag}
                onChange={(e) => handleChange('autoApproveFlag', e.target.value)}
                placeholder={registryDefaults.autoApproveFlag || '(none)'}
                className="font-mono text-code"
              />
            </div>

            {/* Initial Prompt Flag */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="initialPromptFlag" className="text-body tracking-body font-medium">
                  Initial Prompt Flag
                </Label>
                <FieldTooltip content="Flag for passing initial prompt (empty means pass directly)" />
              </div>
              <Input
                id="initialPromptFlag"
                value={form.initialPromptFlag}
                onChange={(e) => handleChange('initialPromptFlag', e.target.value)}
                placeholder={registryDefaults.initialPromptFlag || '(pass directly)'}
                className="font-mono text-code"
              />
            </div>

            {/* Preview */}
            <div className="mt-6 rounded-lg border border-border/60 bg-surface-inset p-4">
              <div className="mb-2 text-tiny tracking-tiny font-medium text-text-muted">
                Command Preview
              </div>
              <code className="block break-all font-mono text-code text-text">
                {previewCommand}
              </code>
            </div>

            {isOverridden && (
              <div className="rounded-md border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-tiny tracking-tiny text-status-warn">
                Custom configuration is applied
              </div>
            )}

            {saveError && (
              <div className="rounded-md border border-status-err-border bg-status-err-bg px-3 py-2 text-tiny tracking-tiny text-status-err">
                Couldn&apos;t save these settings: {saveError}
              </div>
            )}
          </div>
        )}
      </DialogContentArea>

      <div className="flex items-center justify-between border-t border-border/60 px-6 py-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResetToDefaults}
          disabled={isLoading || !!loadError || saving}
          className="gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to Defaults
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <ConfirmButton
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={
              isLoading || !!loadError || saving || !hasChanges || invalidEnvKeys.length > 0
            }
          >
            {saving ? 'Saving...' : 'Save'}
          </ConfirmButton>
        </div>
      </div>
    </>
  );
};
