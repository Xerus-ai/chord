import { Check, Loader2, Plus, Zap } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

/**
 * Team Pulse: the OpenRouter key and the model it pays for, in one card.
 *
 * These were two sections apart — the key in the integrations grid, the model
 * below it — which left the model field naming a provider the user had no
 * visible way to connect, and no statement of who gets billed. Nothing proxies
 * these calls, so the answer is "you do", and the card says so next to the
 * field that starts the spending.
 */
const TeamPulseCard: React.FC = () => {
  const {
    value: teamPulse,
    defaults,
    update,
    isLoading,
    isSaving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('teamPulse');

  // `null` means the check itself failed, which is not the same as "no key
  // saved". The model field stays usable in that case rather than locking a
  // user out on the strength of a failed request.
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    rpc.openRouter.checkConnection().then(
      (r) => {
        if (cancelled) return;
        setConnected(r.connected);
        setConnectionError(null);
      },
      (checkError: unknown) => {
        if (cancelled) return;
        setConnectionError(
          checkError instanceof Error
            ? checkError.message
            : 'Could not check the OpenRouter connection.'
        );
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setConnectionError('API key cannot be empty.');
      return;
    }
    setKeyLoading(true);
    setConnectionError(null);
    try {
      const result = await rpc.openRouter.saveKey(trimmedKey);
      if (result.success) {
        setConnected(true);
        setShowKeyInput(false);
        setApiKey('');
      } else {
        setConnectionError(result.error ?? 'Failed to save key.');
      }
    } catch (saveError) {
      setConnectionError(saveError instanceof Error ? saveError.message : 'Failed to save key.');
    } finally {
      setKeyLoading(false);
    }
  }, [apiKey]);

  const handleDisconnect = useCallback(async () => {
    setConnectionError(null);
    try {
      await rpc.openRouter.clearKey();
      setConnected(false);
    } catch (clearError) {
      setConnectionError(
        clearError instanceof Error ? clearError.message : 'Failed to remove the key.'
      );
    }
  }, []);

  const storedModel = teamPulse?.model ?? '';
  const [draft, setDraft] = useState(storedModel);

  useEffect(() => {
    setDraft(storedModel);
  }, [storedModel]);

  const trimmed = draft.trim();
  const isDirty = trimmed !== storedModel;
  const isDisconnected = connected === false;

  const applyModel = () => {
    if (!trimmed || !isDirty || isDisconnected) return;
    update({ model: trimmed });
  };

  return (
    // The section band (`SettingsPage`) is the container; no box of its own.
    <div className="flex flex-col gap-4 py-3.5">
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-inset">
          <Zap className="h-5 w-5 text-text-passive" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          <h3 className="text-body tracking-body font-medium text-text">OpenRouter API key</h3>
          <p className="text-body tracking-body text-text-passive">
            {connected
              ? 'Connected — billed to your own OpenRouter account.'
              : 'Billed to your own OpenRouter account. Chord never proxies these calls.'}
          </p>
        </div>
        {connected ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => void handleDisconnect()}
            aria-label="Disconnect OpenRouter"
          >
            <Check className="h-4 w-4 text-status-ok" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setShowKeyInput(!showKeyInput)}
            aria-label="Connect OpenRouter"
          >
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {showKeyInput && !connected && (
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="sk-or-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleConnect();
            }}
            disabled={keyLoading}
            className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-tiny tracking-tiny text-text outline-none transition-colors placeholder:text-text-passive focus:border-selected-border disabled:bg-action-bg-disabled disabled:text-action-fg-disabled"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void handleConnect()}
            disabled={!apiKey.trim() || keyLoading}
          >
            {keyLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
          </Button>
        </div>
      )}

      {connectionError && (
        <p className="text-tiny tracking-tiny text-status-err">{connectionError}</p>
      )}

      <div className="h-px bg-border" />

      <SettingRow
        title="Model"
        description={
          <>
            Runs only when you press Generate Pulse, at roughly 300 tokens per teammate. Default:{' '}
            <code className="font-mono">{defaults?.model ?? ''}</code>
          </>
        }
        control={
          <ResetToDefaultButton
            visible={isFieldOverridden('model')}
            defaultLabel={defaults?.model}
            onReset={() => resetField('model')}
            disabled={isLoading || isSaving || isDisconnected}
          />
        }
      />
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyModel();
            }
          }}
          disabled={isLoading || isDisconnected}
          placeholder={defaults?.model ?? 'provider/model-id'}
          aria-label="Team Pulse model"
          className="h-8 flex-1 font-mono text-code"
        />
        <Button
          type="button"
          size="sm"
          onClick={applyModel}
          disabled={isLoading || isSaving || !trimmed || !isDirty || isDisconnected}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
      </div>
      {isDisconnected && (
        <p className="text-tiny tracking-tiny text-text-passive">
          Connect OpenRouter above to use Team Pulse.
        </p>
      )}
    </div>
  );
};

export default TeamPulseCard;
