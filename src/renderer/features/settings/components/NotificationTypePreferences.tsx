import { useQueryClient } from '@tanstack/react-query';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  isNotificationPreferenceType,
  type NotificationPreference as NotificationPref,
  type NotificationPreferenceType,
} from '@shared/notification-preferences';
import { NOTIFICATION_PREFERENCES_KEY } from '@renderer/features/notifications/use-notification-channels';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { Switch } from '@renderer/lib/ui/switch';

const TYPE_LABELS: Record<NotificationPreferenceType, { label: string; description: string }> = {
  shared_with_you: {
    label: 'Shared with you',
    description: 'A teammate shared a work item or an artifact with you.',
  },
  artifact_comment: {
    label: 'Comment on your artifact',
    description: 'Someone commented on an artifact in your work item.',
  },
  new_message: {
    label: 'New message',
    description: 'Someone sent a message in a shared work item you are not looking at.',
  },
  review_requested: {
    label: 'Review requested',
    description: 'Someone requested your review on a work item.',
  },
  changes_requested: {
    label: 'Changes requested',
    description: 'A reviewer requested changes on your work.',
  },
  mentioned: {
    label: 'Mentioned',
    description: 'You were mentioned in a comment or message.',
  },
  agent_blocked: {
    label: 'Agent blocked',
    description: 'An agent needs your input to continue.',
  },
  agent_done: {
    label: 'Agent done',
    description: 'An agent finished its task.',
  },
  pr_merged: {
    label: 'PR merged',
    description: 'A pull request was merged.',
  },
  gate_passed: {
    label: 'Gate passed',
    description: 'A workflow gate check passed.',
  },
  gate_failed: {
    label: 'Gate failed',
    description: 'A workflow gate check failed.',
  },
};

const NotificationTypePreferences: React.FC = () => {
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<NotificationPref[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Imperative mirror of `preferences`: rapid toggles must each build their
  // payload from the state INCLUDING the previous toggle's optimistic write,
  // not from a render-captured snapshot that silently reverts it.
  const preferencesRef = useRef<NotificationPref[]>([]);
  // Per-type send chain, so two toggles on one row can't resolve out of
  // order and leave the UI contradicting persisted state.
  const sendChains = useRef(new Map<string, Promise<void>>());

  const loadPreferences = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await rpc.notificationPreferences.getAll();
      preferencesRef.current = result.data.preferences;
      setPreferences(result.data.preferences);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  const handleToggle = useCallback(
    (type: string, channel: 'in_app' | 'desktop' | 'sound', value: boolean) => {
      const current = preferencesRef.current.find((p) => p.notification_type === type);
      if (!current) return;

      const next = { ...current, [channel]: value };
      preferencesRef.current = preferencesRef.current.map((p) =>
        p.notification_type === type ? next : p
      );
      setPreferences(preferencesRef.current);

      const tail = sendChains.current.get(type) ?? Promise.resolve();
      const send = tail.then(async () => {
        try {
          await rpc.notificationPreferences.update({
            notificationType: type,
            inApp: next.in_app,
            desktop: next.desktop,
            sound: next.sound,
          });
        } catch (e) {
          toast({
            title: 'Could not save notification preference',
            description: e instanceof Error ? e.message : String(e),
            variant: 'destructive',
          });
          // Converge on the server's persisted truth instead of guessing a
          // rollback from a possibly-stale snapshot.
          void loadPreferences();
        } finally {
          // The bell and the banners read the switches through this query.
          void queryClient.invalidateQueries({ queryKey: NOTIFICATION_PREFERENCES_KEY });
        }
      });
      sendChains.current.set(type, send);
    },
    [loadPreferences, queryClient]
  );

  if (loading) {
    return <div className="text-body tracking-body text-text-passive">Loading preferences...</div>;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-md border border-status-err-border bg-status-err-bg p-3">
        <p className="text-body tracking-body text-status-err">
          Couldn&apos;t load notification preferences
        </p>
        <p className="text-tiny tracking-tiny text-text-passive">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadPreferences()}
          className="rounded-md border border-border px-3 py-1 text-tiny tracking-tiny text-text transition-colors hover:bg-surface-raised"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-2 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-1">
        <span className="text-tiny tracking-tiny font-medium text-text-muted">Type</span>
        <span className="w-12 text-center text-tiny tracking-tiny font-medium text-text-muted">
          In-app
        </span>
        <span className="w-12 text-center text-tiny tracking-tiny font-medium text-text-muted">
          Desktop
        </span>
        <span className="w-12 text-center text-tiny tracking-tiny font-medium text-text-muted">
          Sound
        </span>
      </div>

      {preferences.map((pref) => {
        const meta = isNotificationPreferenceType(pref.notification_type)
          ? TYPE_LABELS[pref.notification_type]
          : undefined;
        const label = meta?.label ?? pref.notification_type;
        return (
          <div
            key={pref.notification_type}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 rounded-md px-1 py-2 transition-colors hover:bg-surface-raised"
          >
            <div>
              <div className="text-body tracking-body text-text">{label}</div>
              {meta?.description && (
                <div className="text-tiny tracking-tiny text-text-passive">{meta.description}</div>
              )}
            </div>
            <div className="flex w-12 justify-center">
              <Switch
                checked={pref.in_app}
                aria-label={`${label}: in-app`}
                onCheckedChange={(v) => void handleToggle(pref.notification_type, 'in_app', v)}
              />
            </div>
            <div className="flex w-12 justify-center">
              <Switch
                checked={pref.desktop}
                aria-label={`${label}: desktop`}
                onCheckedChange={(v) => void handleToggle(pref.notification_type, 'desktop', v)}
              />
            </div>
            <div className="flex w-12 justify-center">
              <Switch
                checked={pref.sound}
                aria-label={`${label}: sound`}
                onCheckedChange={(v) => void handleToggle(pref.notification_type, 'sound', v)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default NotificationTypePreferences;
