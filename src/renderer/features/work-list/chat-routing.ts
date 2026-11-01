/**
 * Who a composed message is addressed to (mention-routing design doc). Pure
 * and free of Electron/cloud imports so both composers can share it and the
 * token rules stay testable without mounting a component — same rationale as
 * `chat-mentions.ts`.
 */

/** The fields of a cloud `Participant` routing actually reads. */
export interface RoutableParticipant {
  user_id: string;
  email: string;
  /** Display name — the form mentions are written in. Null when unset. */
  name: string | null;
}

export type ChatAudience = 'agent' | 'thread';

export interface ResolvedRoute {
  /**
   * Who the message is addressed to. Under open prompting this no longer
   * decides whether the agent is woken — in an owner's thread it always is —
   * only how the message is framed for it, and whether a participant's send
   * is allowed to spend a turn under the work item's approval policy.
   */
  audience: ChatAudience;
  /** Participants to notify — expanded to everyone when `@everyone` is used. */
  mentionedUserIds: string[];
  /**
   * The same people by display name, in the same order — what the agent is
   * told the message was addressed to. Falls back to the email when a
   * participant has no name set.
   */
  mentionedNames: string[];
  everyone: boolean;
  /**
   * The literal `@agent` token is present. Distinct from `audience === 'agent'`,
   * which an untagged default can also produce: the participant composer blocks
   * an EXPLICIT agent address under approval_policy='owner', but routes an
   * untagged message to the thread instead.
   */
  mentionsAgent: boolean;
  /** A leading slash — an agent command, whose mentions are plain text. */
  isSlashCommand: boolean;
}

export type MentionTokenKind = 'agent' | 'everyone' | 'person';

/** One recognised `@…` run inside a message, located for highlighting. */
export interface MentionSpan {
  /** Index of the `@`. */
  start: number;
  /** Index one past the last character of the token. */
  end: number;
  /** The literal text, `@` included, exactly as the author typed it. */
  text: string;
  kind: MentionTokenKind;
  /** The participant this token addresses; null for `@agent` / `@everyone`. */
  userId: string | null;
}

// Same rule as sendMessageToAgent / command-executors: a leading slash is
// an agent command and only executes as the very start of the message.
const SLASH_COMMAND = /^\/[A-Za-z0-9]/;

// Names that would shadow a routing token can never be mentioned by name — the
// bare `@agent` addresses the agent, and nothing may take that away from it.
const RESERVED_MENTION_NAMES = new Set(['agent', 'everyone']);

// What may NOT follow a token for it to count. Both halves of the old regex
// pair survive here: the email rule keeps "user@agentmail.com" from addressing
// the agent and keeps `@ana@example.com` from stopping at a shorter prefix,
// while the name rule lets "@Ana." end a sentence but refuses to read "@Ana"
// out of "@Ana-Marie".
const EMAIL_TAIL = /[\w@.+-]/;
const NAME_TAIL = /[\w'-]/;

interface MentionCandidate {
  /** Lowercased text after the `@`. */
  token: string;
  kind: MentionTokenKind;
  userId: string | null;
  email: boolean;
}

/**
 * How many distinct participants answer to each display name. Two people
 * called "Alex Kim" make `@Alex Kim` undeliverable — see `mentionTokenFor`.
 */
function countNameOwners(participants: readonly RoutableParticipant[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const p of participants) {
    const name = p.name?.trim().toLowerCase();
    if (!name || RESERVED_MENTION_NAMES.has(name)) continue;
    const existing = owners.get(name);
    if (existing) existing.add(p.user_id);
    else owners.set(name, new Set([p.user_id]));
  }
  return owners;
}

/**
 * The token the menu inserts for a participant: their display name, or their
 * email when the name is missing, reserved, or shared with someone else in the
 * work item. A shared name is the case Slack disambiguates with a secondary
 * identifier — here the identifier IS the token, so the message stays
 * deliverable to exactly one person.
 */
export function mentionTokenFor(
  participant: RoutableParticipant,
  participants: readonly RoutableParticipant[]
): string {
  const name = participant.name?.trim();
  if (!name) return participant.email;
  const lower = name.toLowerCase();
  if (RESERVED_MENTION_NAMES.has(lower)) return participant.email;
  return (countNameOwners(participants).get(lower)?.size ?? 0) > 1 ? participant.email : name;
}

function buildCandidates(participants: readonly RoutableParticipant[]): MentionCandidate[] {
  const candidates: MentionCandidate[] = [
    { token: 'agent', kind: 'agent', userId: null, email: false },
  ];
  // With nobody to address, `@everyone` is prose: solo sessions route exactly
  // as they did before mention routing existed.
  if (participants.length > 0) {
    candidates.push({ token: 'everyone', kind: 'everyone', userId: null, email: false });
  }

  const owners = countNameOwners(participants);
  for (const p of participants) {
    candidates.push({
      token: p.email.toLowerCase(),
      kind: 'person',
      userId: p.user_id,
      email: true,
    });
    const name = p.name?.trim().toLowerCase();
    // An ambiguous name is dropped rather than guessed: notifying the wrong
    // teammate is worse than rendering the text plain.
    if (!name || RESERVED_MENTION_NAMES.has(name) || (owners.get(name)?.size ?? 0) > 1) continue;
    candidates.push({ token: name, kind: 'person', userId: p.user_id, email: false });
  }

  // Longest first, so "@Ana Lee" resolves Ana Lee and not Ana, and
  // "@ana@example.com" resolves the address and not the display name inside it.
  return candidates.sort((a, b) => b.token.length - a.token.length);
}

/**
 * Every mention in `content`, in the order it appears. A token counts only at
 * the start of the message or after whitespace, and only when nothing that
 * would continue it follows.
 *
 * Shared by routing and by the pill rendering in messages and composers, so
 * what is highlighted is exactly what gets notified.
 */
export function findMentions(
  content: string,
  participants: readonly RoutableParticipant[]
): MentionSpan[] {
  const candidates = buildCandidates(participants);
  const lower = content.toLowerCase();
  const spans: MentionSpan[] = [];

  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '@') continue;
    if (i > 0 && !/\s/.test(content[i - 1])) continue;
    for (const candidate of candidates) {
      const end = i + 1 + candidate.token.length;
      if (lower.slice(i + 1, end) !== candidate.token) continue;
      const tail = content[end];
      if (tail !== undefined && (candidate.email ? EMAIL_TAIL : NAME_TAIL).test(tail)) continue;
      spans.push({
        start: i,
        end,
        text: content.slice(i, end),
        kind: candidate.kind,
        userId: candidate.userId,
      });
      // Resume after the token: the text it consumed can't start another one.
      i = end - 1;
      break;
    }
  }

  return spans;
}

/**
 * Resolves the audience and notification set for a draft.
 *
 * `untaggedAudience` is the sender's default for a message carrying no
 * mentions: 'agent' for the owner (their session, their agent), and for a
 * participant whichever the work item's approval_policy allows. Mentions
 * always override it — `@agent` wins outright and people-only mentions
 * address the thread. A 'thread' message starts no agent turn, for the owner
 * or a teammate: the agent reads it in the thread digest on its next turn.
 */
export function resolveRoute(
  content: string,
  participants: readonly RoutableParticipant[],
  untaggedAudience: ChatAudience = 'agent'
): ResolvedRoute {
  if (SLASH_COMMAND.test(content.trim())) {
    return {
      audience: 'agent',
      mentionedUserIds: [],
      mentionedNames: [],
      everyone: false,
      mentionsAgent: false,
      isSlashCommand: true,
    };
  }

  const spans = findMentions(content, participants);
  const mentionsAgent = spans.some((s) => s.kind === 'agent');
  const everyone = spans.some((s) => s.kind === 'everyone');
  const named = new Set(spans.map((s) => s.userId).filter((id): id is string => id !== null));
  // Roster order, not mention order, so the notified set is stable however the
  // sentence was phrased.
  const addressed = participants.filter((p) => everyone || named.has(p.user_id));
  const mentionedUserIds = addressed.map((p) => p.user_id);
  const mentionedNames = addressed.map((p) => p.name?.trim() || p.email);

  return {
    audience: mentionsAgent ? 'agent' : mentionedUserIds.length > 0 ? 'thread' : untaggedAudience,
    mentionedUserIds,
    mentionedNames,
    everyone,
    mentionsAgent,
    isSlashCommand: false,
  };
}
