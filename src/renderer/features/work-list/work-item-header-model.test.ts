import { describe, expect, it } from 'vitest';
import { resolveWorkItemCapabilities, type WorkItemAccessInput } from './work-item-access';
import {
  headerModel,
  SHARE_OWNER_ONLY_REASON,
  type HeaderModelInput,
} from './work-item-header-model';

const person = (user_id: string, name: string) => ({
  user_id,
  name,
  email: `${name.toLowerCase()}@example.com`,
});
const RAGHAV = person('u-raghav', 'Raghav');
const MAYA = person('u-maya', 'Maya');

const caps = (input: WorkItemAccessInput) => resolveWorkItemCapabilities(input);
const OWNER = caps({ viewer: 'owner', role: 'edit', scope: 'work_item', approvalPolicy: 'owner' });
const EDITOR = caps({
  viewer: 'member',
  role: 'edit',
  scope: 'work_item',
  approvalPolicy: 'owner',
});

const base: HeaderModelInput = {
  capabilities: OWNER,
  title: 'Kami',
  repoBadge: 'kami',
  shareUnavailableReason: null,
  ownerLabel: null,
  status: null,
  branch: null,
  prNumber: null,
  participants: [RAGHAV, MAYA],
  viewers: [],
  selfId: 'u-raghav',
};

/** One header for both viewers (step 4, S6): what it shows follows the capabilities. */
describe('headerModel', () => {
  it('lets the owner rename and share, and names nobody as the sharer', () => {
    const model = headerModel(base);
    expect(model).toMatchObject({
      title: 'Kami',
      canRename: true,
      share: { kind: 'open' },
      sharedBy: null,
      openInEditor: true,
    });
    expect(model.stack.members.map((m) => m.user_id)).toEqual(['u-maya']);
  });

  it("blocks the owner's Share with the reason sharing is not available yet", () => {
    const model = headerModel({ ...base, shareUnavailableReason: 'Sign in to share.' });
    expect(model.share).toEqual({ kind: 'blocked', reason: 'Sign in to share.' });
  });

  it('shows a teammate who shared it, its status, branch and PR, and no rename', () => {
    const model = headerModel({
      ...base,
      capabilities: EDITOR,
      ownerLabel: 'Raghav',
      status: 'in_progress',
      branch: 'feat/kami',
      prNumber: 42,
      selfId: 'u-maya',
    });
    expect(model).toMatchObject({
      canRename: false,
      share: { kind: 'blocked', reason: SHARE_OWNER_ONLY_REASON },
      sharedBy: 'Raghav',
      status: 'in_progress',
      branch: 'feat/kami',
      prNumber: 42,
      openInEditor: false,
    });
  });

  it("rings the owner in a teammate's stack while the owner is in the item, a chat included", () => {
    const model = headerModel({
      ...base,
      capabilities: EDITOR,
      selfId: 'u-maya',
      viewers: [{ user_id: 'u-raghav', file: 'session:s1' }],
    });
    expect(model.stack.members.map((m) => m.user_id)).toEqual(['u-raghav']);
    expect([...model.stack.ringedIds]).toEqual(['u-raghav']);
  });

  it('lets the author share from another machine', () => {
    const author = caps({
      viewer: 'member',
      role: 'edit',
      scope: 'work_item',
      approvalPolicy: 'owner',
      author: true,
    });
    expect(headerModel({ ...base, capabilities: author }).share).toEqual({ kind: 'open' });
  });

  it('has no Share for an artifacts-only viewer', () => {
    const artifactsOnly = caps({
      viewer: 'member',
      role: 'view',
      scope: 'artifacts',
      approvalPolicy: 'owner',
    });
    expect(headerModel({ ...base, capabilities: artifactsOnly }).share).toEqual({
      kind: 'hidden',
    });
  });
});
