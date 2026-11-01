import type { NotificationView } from '@chord/protocol';

/** A run of line 1; names are bold, the verb between them is not. */
export interface NotificationSegment {
  text: string;
  bold: boolean;
}

export interface NotificationDescription {
  actor: { name: string; avatarUrl: string | null };
  line1: NotificationSegment[];
  line2: string | null;
}

const ROLE_LABELS: Record<string, string> = { view: 'Can view', edit: 'Can edit' };

/**
 * The sentence a notification shows, built from its facts and the names the
 * server joined in (shared-items design §4). The display rules below are
 * states that exist, not error fallbacks: an account without a name is shown
 * by its email, and something deleted since is said to be deleted.
 */
export function describeNotification(n: NotificationView): NotificationDescription {
  const actor = actorOf(n);
  const who: NotificationSegment = { text: actor.name, bold: true };
  const quoted = n.excerpt === null ? null : `“${n.excerpt}”`;

  switch (n.type) {
    case 'shared_with_you': {
      const role = roleLabel(n.excerpt);
      if (n.artifact_id) {
        return {
          actor,
          line1: [who, verb(' shared '), artifactOf(n)],
          line2: `from ${workItemOf(n).text} · ${role}`,
        };
      }
      const repo = n.work_item_id ? n.work_item_repo_name : null;
      return {
        actor,
        line1: [who, verb(' shared '), workItemOf(n)],
        line2: repo ? `${repo} · ${role}` : role,
      };
    }
    case 'mentioned':
      return n.comment_id
        ? {
            actor,
            line1: [who, verb(' mentioned you in a comment on '), artifactOf(n)],
            line2: quoted,
          }
        : { actor, line1: [who, verb(' mentioned you in '), workItemOf(n)], line2: quoted };
    case 'new_message':
      return { actor, line1: [who, verb(' sent a message in '), workItemOf(n)], line2: quoted };
    case 'artifact_comment':
      return { actor, line1: [who, verb(' commented on '), artifactOf(n)], line2: quoted };
    case 'team_invite':
      return { actor, line1: [who, verb(' invited you to join '), teamOf(n)], line2: null };
  }
}

/** The same two lines as plain text, for the OS notification. */
export function notificationPlainText(d: NotificationDescription): {
  title: string;
  body: string | null;
} {
  return { title: d.line1.map((segment) => segment.text).join(''), body: d.line2 };
}

function actorOf(n: NotificationView): NotificationDescription['actor'] {
  if (n.actor_user_id === null) return { name: 'A deleted account', avatarUrl: null };
  const name = n.actor_name ?? n.actor_email;
  if (name === null) throw new Error(`notification ${n.id}: actor ${n.actor_user_id} has no email`);
  return { name, avatarUrl: n.actor_avatar_url };
}

function verb(text: string): NotificationSegment {
  return { text, bold: false };
}

function named(
  n: NotificationView,
  id: string | null,
  name: string | null,
  deleted: string
): NotificationSegment {
  if (id === null) return { text: deleted, bold: false };
  if (name === null) throw new Error(`notification ${n.id}: ${id} has no name`);
  return { text: name, bold: true };
}

function workItemOf(n: NotificationView): NotificationSegment {
  return named(n, n.work_item_id, n.work_item_name, 'a work item that was deleted');
}

function artifactOf(n: NotificationView): NotificationSegment {
  return named(n, n.artifact_id, n.artifact_name, 'an artifact that was deleted');
}

function teamOf(n: NotificationView): NotificationSegment {
  return named(n, n.org_id, n.org_name, 'a team that was deleted');
}

function roleLabel(role: string | null): string {
  const label = role === null ? undefined : ROLE_LABELS[role];
  if (!label) throw new Error(`shared_with_you with an unknown role: ${role}`);
  return label;
}
