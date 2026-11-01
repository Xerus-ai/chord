/**
 * The notification types Settings → Notifications has a row for. The first
 * four are what the cloud sends (shared-items step 2); a team invite has no
 * row, since the bell is where an invite is accepted.
 */
export const NOTIFICATION_PREFERENCE_TYPES = [
  'shared_with_you',
  'mentioned',
  'artifact_comment',
  'new_message',
  'review_requested',
  'changes_requested',
  'agent_blocked',
  'agent_done',
  'pr_merged',
  'gate_passed',
  'gate_failed',
] as const;

export type NotificationPreferenceType = (typeof NOTIFICATION_PREFERENCE_TYPES)[number];

export interface NotificationPreference {
  id: string;
  notification_type: string;
  in_app: boolean;
  desktop: boolean;
  sound: boolean;
}

export function isNotificationPreferenceType(type: string): type is NotificationPreferenceType {
  return (NOTIFICATION_PREFERENCE_TYPES as readonly string[]).includes(type);
}
