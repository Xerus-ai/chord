import { describe, expect, it } from 'vitest';
import {
  findMentions,
  mentionTokenFor,
  resolveRoute,
  type RoutableParticipant,
} from './chat-routing';

const ANA: RoutableParticipant = {
  user_id: 'u-ana',
  email: 'ana@example.com',
  name: 'Ana Lovelace',
};
const BEN: RoutableParticipant = { user_id: 'u-ben', email: 'ben@example.com', name: 'Ben Hart' };
const ROOM = [ANA, BEN];

describe('resolveRoute', () => {
  it('routes an untagged message to the sender default', () => {
    expect(resolveRoute('ship it', ROOM).audience).toBe('agent');
    expect(resolveRoute('ship it', ROOM, 'thread').audience).toBe('thread');
  });

  it('routes a solo session to the agent with no participants to mention', () => {
    const route = resolveRoute('@everyone @ana@example.com hello', []);
    expect(route.audience).toBe('agent');
    expect(route.everyone).toBe(false);
    expect(route.mentionedUserIds).toEqual([]);
  });

  it('routes a people-only mention to the thread and notifies them', () => {
    const route = resolveRoute('@ana@example.com can you look?', ROOM);
    expect(route.audience).toBe('thread');
    expect(route.mentionsAgent).toBe(false);
    expect(route.mentionedUserIds).toEqual(['u-ana']);
  });

  it('overrides a thread-defaulting sender when people are mentioned', () => {
    expect(resolveRoute('@ben@example.com hi', ROOM, 'thread').audience).toBe('thread');
    expect(resolveRoute('@ben@example.com hi', ROOM, 'agent').audience).toBe('thread');
  });

  it('lets @agent win over people mentions, keeping the notifications', () => {
    const route = resolveRoute('@agent rebase this, @ana@example.com fyi', ROOM);
    expect(route.audience).toBe('agent');
    expect(route.mentionsAgent).toBe(true);
    expect(route.mentionedUserIds).toEqual(['u-ana']);
  });

  it('detects @agent anywhere in the message, not only at the start', () => {
    expect(resolveRoute('one more thing @agent', ROOM).mentionsAgent).toBe(true);
    expect(resolveRoute('@Agent please retry', ROOM).mentionsAgent).toBe(true);
  });

  it('does not read an email address as the @agent token', () => {
    const route = resolveRoute('forward it to user@agentmail.com', ROOM, 'thread');
    expect(route.mentionsAgent).toBe(false);
    expect(route.audience).toBe('thread');
  });

  it('does not let a participant mentioned by full email claim the bare token', () => {
    const agentPerson: RoutableParticipant = {
      user_id: 'u-bot',
      email: 'agent@example.com',
      name: null,
    };
    const route = resolveRoute('@agent@example.com can you review?', [agentPerson]);
    expect(route.mentionsAgent).toBe(false);
    expect(route.audience).toBe('thread');
    expect(route.mentionedUserIds).toEqual(['u-bot']);
  });

  it('needs a boundary before the token', () => {
    expect(resolveRoute('nope@everyone', ROOM).everyone).toBe(false);
    expect(resolveRoute('agents@example.org', ROOM).mentionsAgent).toBe(false);
  });

  it('expands @everyone to every participant id', () => {
    const route = resolveRoute('@everyone standup in 5', ROOM);
    expect(route.audience).toBe('thread');
    expect(route.everyone).toBe(true);
    expect(route.mentionedUserIds).toEqual(['u-ana', 'u-ben']);
  });

  it('combines @everyone with @agent as an agent turn that still notifies', () => {
    const route = resolveRoute('@agent @everyone kicking this off', ROOM);
    expect(route.audience).toBe('agent');
    expect(route.everyone).toBe(true);
    expect(route.mentionedUserIds).toEqual(['u-ana', 'u-ben']);
  });

  it('ignores unknown mention strings', () => {
    const route = resolveRoute('@ghost@example.com are you there?', ROOM, 'thread');
    expect(route.mentionedUserIds).toEqual([]);
    expect(route.audience).toBe('thread');
  });

  it('bypasses routing for a slash command, mentions included', () => {
    const route = resolveRoute('/review @agent @ana@example.com', ROOM, 'thread');
    expect(route.isSlashCommand).toBe(true);
    expect(route.audience).toBe('agent');
    expect(route.mentionsAgent).toBe(false);
    expect(route.mentionedUserIds).toEqual([]);
  });

  it('treats a bare slash as ordinary text', () => {
    const route = resolveRoute('/ @ana@example.com', ROOM);
    expect(route.isSlashCommand).toBe(false);
    expect(route.audience).toBe('thread');
  });
});

describe('resolveRoute — display-name mentions', () => {
  const ANA_SHORT: RoutableParticipant = { user_id: 'u-short', email: 's@x.com', name: 'Ana' };
  const ANA_LONG: RoutableParticipant = { user_id: 'u-long', email: 'l@x.com', name: 'Ana Lee' };
  const KIM_ONE: RoutableParticipant = { user_id: 'u-1', email: 'one@x.com', name: 'Alex Kim' };
  const KIM_TWO: RoutableParticipant = { user_id: 'u-2', email: 'two@x.com', name: 'Alex Kim' };

  it('resolves a display name containing spaces', () => {
    const route = resolveRoute('@Ana Lovelace can you look?', ROOM);
    expect(route.audience).toBe('thread');
    expect(route.mentionedUserIds).toEqual(['u-ana']);
  });

  it('matches names case-insensitively', () => {
    expect(resolveRoute('@ana lovelace ping', ROOM).mentionedUserIds).toEqual(['u-ana']);
    expect(resolveRoute('@ANA LOVELACE ping', ROOM).mentionedUserIds).toEqual(['u-ana']);
  });

  it('takes the longest name match at a position', () => {
    const room = [ANA_SHORT, ANA_LONG];
    expect(resolveRoute('@Ana Lee ship it', room).mentionedUserIds).toEqual(['u-long']);
    expect(resolveRoute('@Ana ship it', room).mentionedUserIds).toEqual(['u-short']);
  });

  it('refuses a name that is only a prefix of what was typed', () => {
    expect(resolveRoute('@Ana Leeson is out', [ANA_LONG]).mentionedUserIds).toEqual([]);
    expect(resolveRoute('@Ana Lee, thanks', [ANA_LONG]).mentionedUserIds).toEqual(['u-long']);
  });

  it('notifies nobody when two participants share a display name', () => {
    const room = [KIM_ONE, KIM_TWO];
    expect(resolveRoute('@Alex Kim please review', room, 'thread').mentionedUserIds).toEqual([]);
    // Their emails stay deliverable, which is the form the menu inserts here.
    expect(resolveRoute('@one@x.com please review', room).mentionedUserIds).toEqual(['u-1']);
  });

  it('keeps @agent ahead of a participant literally named "agent"', () => {
    const bot: RoutableParticipant = { user_id: 'u-bot', email: 'bot@x.com', name: 'agent' };
    const route = resolveRoute('@agent do it', [bot]);
    expect(route.mentionsAgent).toBe(true);
    expect(route.mentionedUserIds).toEqual([]);
  });

  it('mixes a name mention with @agent', () => {
    const route = resolveRoute('@agent rebase, @Ben Hart fyi', ROOM);
    expect(route.audience).toBe('agent');
    expect(route.mentionsAgent).toBe(true);
    expect(route.mentionedUserIds).toEqual(['u-ben']);
  });

  it('reports both mentioned people in roster order', () => {
    const route = resolveRoute('@Ben Hart and @Ana Lovelace — sync?', ROOM);
    expect(route.mentionedUserIds).toEqual(['u-ana', 'u-ben']);
  });
});

describe('findMentions', () => {
  it('locates each token with the exact text that was typed', () => {
    expect(findMentions('hey @Ana Lovelace and @agent', ROOM)).toEqual([
      { start: 4, end: 17, text: '@Ana Lovelace', kind: 'person', userId: 'u-ana' },
      { start: 22, end: 28, text: '@agent', kind: 'agent', userId: null },
    ]);
  });

  it('does not find a token inside an email address', () => {
    expect(findMentions('mail user@agentmail.com now', ROOM)).toEqual([]);
  });

  it('finds @everyone only when there is a room to address', () => {
    expect(findMentions('@everyone hi', ROOM).map((s) => s.kind)).toEqual(['everyone']);
    expect(findMentions('@everyone hi', [])).toEqual([]);
  });
});

describe('mentionTokenFor', () => {
  it('uses the display name when it is unambiguous', () => {
    expect(mentionTokenFor(ANA, ROOM)).toBe('Ana Lovelace');
  });

  it('falls back to the email when there is no display name', () => {
    const nameless: RoutableParticipant = { user_id: 'u-x', email: 'x@x.com', name: null };
    expect(mentionTokenFor(nameless, [nameless])).toBe('x@x.com');
  });

  it('disambiguates a shared display name with the email', () => {
    const one: RoutableParticipant = { user_id: 'u-1', email: 'one@x.com', name: 'Alex Kim' };
    const two: RoutableParticipant = { user_id: 'u-2', email: 'two@x.com', name: 'Alex Kim' };
    expect(mentionTokenFor(one, [one, two])).toBe('one@x.com');
    expect(mentionTokenFor(two, [one, two])).toBe('two@x.com');
  });

  it('never lets a person claim a routing token by name', () => {
    const bot: RoutableParticipant = { user_id: 'u-bot', email: 'bot@x.com', name: 'agent' };
    expect(mentionTokenFor(bot, [bot])).toBe('bot@x.com');
  });
});
