import { describe, expect, it } from 'vitest';
import {
  AGENT_ACCESS_REASON,
  ENDED_CHAT_REASON,
  mentionKindsFor,
  READ_ONLY_REASON,
  resolveComposerAccess,
} from './composer-access';
import { resolveWorkItemCapabilities, type WorkItemAccessInput } from './work-item-access';

const OWNER = resolveWorkItemCapabilities({
  viewer: 'owner',
  role: 'edit',
  scope: 'work_item',
  approvalPolicy: 'owner',
});
const member = (role: 'edit' | 'view', approvalPolicy: WorkItemAccessInput['approvalPolicy']) =>
  resolveWorkItemCapabilities({ viewer: 'member', role, scope: 'work_item', approvalPolicy });

/**
 * Why a composer cannot send, or cannot reach the agent (step 4, S5c): one
 * answer for both viewers, from the capabilities, the room and the owner's
 * device.
 */
describe('resolveComposerAccess', () => {
  it("leaves the owner's composer open", () => {
    expect(
      resolveComposerAccess({ capabilities: OWNER, connection: 'local', deviceOnline: true })
    ).toEqual({ blockedReason: null, agentBlockedReason: null, notice: null, ended: false });
  });

  it('blocks Can view with the role reason, before any connection reason', () => {
    const access = resolveComposerAccess({
      capabilities: member('view', 'participants'),
      connection: 'joining',
      deviceOnline: true,
    });
    expect(access.blockedReason).toBe(READ_ONLY_REASON);
  });

  it('keeps the thread open but not the agent under an owner-only policy', () => {
    expect(
      resolveComposerAccess({
        capabilities: member('edit', 'owner'),
        connection: 'joined',
        deviceOnline: true,
      })
    ).toEqual({
      blockedReason: null,
      agentBlockedReason: AGENT_ACCESS_REASON,
      notice: null,
      ended: false,
    });
  });

  it('opens the agent when the owner delegates it', () => {
    const access = resolveComposerAccess({
      capabilities: member('edit', 'participants'),
      connection: 'joined',
      deviceOnline: true,
    });
    expect(access.agentBlockedReason).toBeNull();
  });

  it('blocks sending until the room is joined, and names which', () => {
    const edit = member('edit', 'participants');
    expect(
      resolveComposerAccess({ capabilities: edit, connection: 'joining', deviceOnline: true })
        .blockedReason
    ).toBe('Connecting to the session — sending is disabled until the room is joined.');
    expect(
      resolveComposerAccess({ capabilities: edit, connection: null, deviceOnline: true })
        .blockedReason
    ).toBe('Not connected to the session — sending is disabled.');
  });

  it("says a prompt waits while the owner's device is offline, without blocking it", () => {
    const access = resolveComposerAccess({
      capabilities: member('edit', 'participants'),
      connection: 'joined',
      deviceOnline: false,
    });
    expect(access.blockedReason).toBeNull();
    expect(access.notice).toBe(
      "The owner's device is offline — prompts to the agent wait until it is back."
    );
  });

  it('has no offline notice for a teammate who cannot prompt the agent', () => {
    const access = resolveComposerAccess({
      capabilities: member('edit', 'owner'),
      connection: 'joined',
      deviceOnline: false,
    });
    expect(access.notice).toBeNull();
  });

  // Step 5, decision 5: an ended chat reopened from `+` or by a notification
  // takes no more messages, for the owner and the teammate alike. Nothing
  // tells the teammate to start a chat: they cannot. `ended` is what the
  // composer reads to show itself closed — no pickers, no +, no send — rather
  // than live-looking controls under a sentence saying they are not
  // (devstation-9yc).
  it('closes an ended chat to everyone, before any role or connection reason', () => {
    for (const [capabilities, connection] of [
      [OWNER, 'local'],
      [member('edit', 'participants'), 'joined'],
      [member('view', 'owner'), null],
    ] as const) {
      const access = resolveComposerAccess({
        capabilities,
        connection,
        deviceOnline: false,
        ended: true,
      });
      expect(access).toEqual({
        blockedReason: ENDED_CHAT_REASON,
        agentBlockedReason: null,
        notice: null,
        ended: true,
      });
    }
    expect(ENDED_CHAT_REASON).toBe('This chat has ended.');
  });

  it('refuses a viewer who has no chat at all', () => {
    const artifactsOnly = resolveWorkItemCapabilities({
      viewer: 'member',
      role: 'view',
      scope: 'artifacts',
      approvalPolicy: 'owner',
    });
    expect(() =>
      resolveComposerAccess({
        capabilities: artifactsOnly,
        connection: 'joined',
        deviceOnline: true,
      })
    ).toThrow();
  });
});

describe('mentionKindsFor', () => {
  it('offers files only to a viewer with the checkout', () => {
    expect([...mentionKindsFor(OWNER)].sort()).toEqual(['files', 'people', 'work-items']);
    expect([...mentionKindsFor(member('edit', 'owner'))].sort()).toEqual(['people', 'work-items']);
  });
});
