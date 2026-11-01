import { describe, expect, it } from 'vitest';
import {
  resolveWorkItemCapabilities,
  type WorkItemAccessInput,
  type WorkItemCapabilities,
} from './work-item-access';

/**
 * Shared-items design §6: what each viewer of a work item can do, as one pure
 * function. Every row of the design's table is asserted per column: owner,
 * teammate on the work item (Can edit and Can view), teammate reached through
 * artifacts only.
 */

const OWNER: WorkItemAccessInput = {
  viewer: 'owner',
  role: 'edit',
  scope: 'work_item',
  approvalPolicy: 'owner',
};
const EDITOR: WorkItemAccessInput = {
  viewer: 'member',
  role: 'edit',
  scope: 'work_item',
  approvalPolicy: 'owner',
};
const VIEWER: WorkItemAccessInput = { ...EDITOR, role: 'view' };
const ARTIFACTS_ONLY: WorkItemAccessInput = { ...VIEWER, scope: 'artifacts' };

function caps(input: WorkItemAccessInput): WorkItemCapabilities {
  return resolveWorkItemCapabilities(input);
}

describe('resolveWorkItemCapabilities: the design table', () => {
  it('chat tabs: owner full, Can edit composes, Can view reads, artifacts only none', () => {
    expect(caps(OWNER).chat).toBe('full');
    expect(caps(EDITOR).chat).toBe('compose');
    expect(caps(VIEWER).chat).toBe('read');
    expect(caps(ARTIFACTS_ONLY).chat).toBe('none');
  });

  it('terminal tabs: the owner only (a PTY is local)', () => {
    expect(caps(OWNER).terminal).toBe(true);
    expect(caps(EDITOR).terminal).toBe(false);
    expect(caps(VIEWER).terminal).toBe(false);
    expect(caps(ARTIFACTS_ONLY).terminal).toBe(false);
  });

  it('changes: owner and work-item teammates, not artifacts only', () => {
    expect(caps(OWNER).changes).toBe(true);
    expect(caps(EDITOR).changes).toBe(true);
    expect(caps(VIEWER).changes).toBe(true);
    expect(caps(ARTIFACTS_ONLY).changes).toBe(false);
  });

  it("files: the owner only (the repo is on the owner's machine)", () => {
    expect(caps(OWNER).files).toBe(true);
    expect(caps(EDITOR).files).toBe(false);
    expect(caps(VIEWER).files).toBe(false);
    expect(caps(ARTIFACTS_ONLY).files).toBe(false);
  });

  it('artifact tabs: all of them, or only the shared ones', () => {
    expect(caps(OWNER).artifactTabs).toBe('all');
    expect(caps(EDITOR).artifactTabs).toBe('all');
    expect(caps(VIEWER).artifactTabs).toBe('all');
    expect(caps(ARTIFACTS_ONLY).artifactTabs).toBe('shared');
  });

  it('modes: Diff · Preview · Edit, Diff · Preview, Preview', () => {
    expect(caps(OWNER).documentModes).toEqual(['diff', 'preview', 'edit']);
    expect(caps(EDITOR).documentModes).toEqual(['diff', 'preview']);
    expect(caps(VIEWER).documentModes).toEqual(['diff', 'preview']);
    expect(caps(ARTIFACTS_ONLY).documentModes).toEqual(['preview']);
  });

  it("plain files: the owner's every mode, a teammate's diff, nothing for artifacts only", () => {
    expect(caps(OWNER).fileModes).toEqual(['diff', 'preview', 'edit']);
    expect(caps(EDITOR).fileModes).toEqual(['diff']);
    expect(caps(VIEWER).fileModes).toEqual(['diff']);
    expect(caps(ARTIFACTS_ONLY).fileModes).toEqual([]);
  });

  it('comments: everyone comments; Ask agent is not for artifacts only; mentions follow work-item access', () => {
    expect(caps(OWNER).comments).toEqual({ comment: true, askAgent: true, mentions: true });
    expect(caps(EDITOR).comments).toEqual({ comment: true, askAgent: true, mentions: true });
    expect(caps(VIEWER).comments).toEqual({ comment: true, askAgent: true, mentions: true });
    expect(caps(ARTIFACTS_ONLY).comments).toEqual({
      comment: true,
      askAgent: false,
      mentions: false,
    });
  });

  it('versions: everyone views, only the owner restores', () => {
    expect(caps(OWNER).versions).toEqual({ view: true, restore: true });
    expect(caps(EDITOR).versions).toEqual({ view: true, restore: false });
    expect(caps(VIEWER).versions).toEqual({ view: true, restore: false });
    expect(caps(ARTIFACTS_ONLY).versions).toEqual({ view: true, restore: false });
  });

  it('share: the owner manages, a work-item teammate is told why not, artifacts only hides it', () => {
    expect(caps(OWNER).share).toBe('manage');
    expect(caps(EDITOR).share).toBe('blocked');
    expect(caps(VIEWER).share).toBe('blocked');
    expect(caps(ARTIFACTS_ONLY).share).toBe('hidden');
    // The author, reading their item on another machine, is a member who still shares it.
    expect(caps({ ...EDITOR, author: true }).share).toBe('manage');
  });
});

describe('resolveWorkItemCapabilities: the rail', () => {
  it('shows only the panels a viewer can use, in the manifest order', () => {
    // Run is the owner's: the processes run on their machine, in their checkout.
    expect(caps(OWNER).railPanels).toEqual([
      'work-item',
      'source-control',
      'explorer',
      'checks-pr',
      'run',
    ]);
    expect(caps(EDITOR).railPanels).toEqual(['work-item', 'source-control', 'checks-pr']);
    expect(caps(VIEWER).railPanels).toEqual(['work-item', 'source-control', 'checks-pr']);
    expect(caps(ARTIFACTS_ONLY).railPanels).toEqual(['work-item']);
  });
});

describe('resolveWorkItemCapabilities: owner-only affordances', () => {
  it.each([
    ['checkpoints'],
    ['stopAgent'],
    ['deleteArtifact'],
    ['editItem'],
    ['paletteActions'],
    ['configureAgent'],
  ] as const)('%s is the owner only', (field) => {
    expect(caps(OWNER)[field]).toBe(true);
    expect(caps(EDITOR)[field]).toBe(false);
    expect(caps(VIEWER)[field]).toBe(false);
    expect(caps(ARTIFACTS_ONLY)[field]).toBe(false);
  });
});

describe('resolveWorkItemCapabilities: approvals', () => {
  it('the owner always answers', () => {
    expect(caps(OWNER).approvals).toBe('answer');
    expect(caps({ ...OWNER, approvalPolicy: 'participants' }).approvals).toBe('answer');
  });

  it("a teammate answers only when the owner delegated and they can edit (the server's rule)", () => {
    expect(caps(EDITOR).approvals).toBe('owner_only');
    expect(caps({ ...EDITOR, approvalPolicy: 'participants' }).approvals).toBe('answer');
    // POST /commands requires edit (server/src/routes/commands.ts:116).
    expect(caps({ ...VIEWER, approvalPolicy: 'participants' }).approvals).toBe('owner_only');
  });

  it('artifacts only sees no approvals', () => {
    expect(caps({ ...ARTIFACTS_ONLY, approvalPolicy: 'participants' }).approvals).toBe('none');
  });
});

describe('resolveWorkItemCapabilities: live inputs', () => {
  it('a demotion to Can view takes the composer and approvals away at once', () => {
    const before = caps({ ...EDITOR, approvalPolicy: 'participants' });
    const after = caps({ ...EDITOR, approvalPolicy: 'participants', role: 'view' });
    expect([before.chat, before.approvals]).toEqual(['compose', 'answer']);
    expect([after.chat, after.approvals]).toEqual(['read', 'owner_only']);
  });

  it('the owner is the owner whatever role the input names', () => {
    expect(caps({ ...OWNER, role: 'view' })).toEqual(caps(OWNER));
  });

  it('an owner never has an artifacts-only scope', () => {
    expect(() => caps({ ...OWNER, scope: 'artifacts' })).toThrow();
  });
});

describe('resolveWorkItemCapabilities: the work item room', () => {
  it('everyone on the work item joins its room; an artifacts-only viewer never does', () => {
    // The server refuses an artifacts-only caller every work_item: room and
    // route (403 ARTIFACTS_ONLY): presence, participants, git state, chat.
    expect(caps(OWNER).workItemRoom).toBe(true);
    expect(caps(EDITOR).workItemRoom).toBe(true);
    expect(caps(VIEWER).workItemRoom).toBe(true);
    expect(caps(ARTIFACTS_ONLY).workItemRoom).toBe(false);
  });
});

describe('resolveWorkItemCapabilities: prompting the agent', () => {
  const DELEGATED = { approvalPolicy: 'participants' } as const;

  it('the owner prompts; a teammate only with edit and a delegated policy', () => {
    expect(caps(OWNER).promptAgent).toBe(true);
    expect(caps(EDITOR).promptAgent).toBe(false);
    expect(caps({ ...EDITOR, ...DELEGATED }).promptAgent).toBe(true);
    expect(caps({ ...VIEWER, ...DELEGATED }).promptAgent).toBe(false);
    expect(caps({ ...ARTIFACTS_ONLY, ...DELEGATED }).promptAgent).toBe(false);
  });
});
