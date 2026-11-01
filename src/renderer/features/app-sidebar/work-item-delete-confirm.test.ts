import { describe, expect, it } from 'vitest';
import { describeWorkItemDeleteConfirm } from './work-item-delete-confirm';

/**
 * What Delete asks before removing a work item. For a work item on an adopted
 * checkout (plan §Phase 3 slice 6) it says what goes — the work item, its
 * sessions, and the checkpoints Chord wrote — and that the folder, its files
 * and its branch stay, because the checkout is the user's.
 */
describe('describeWorkItemDeleteConfirm', () => {
  it("keeps today's wording for a work item on a checkout Chord made", () => {
    expect(describeWorkItemDeleteConfirm({ name: 'Fix login', adopted: null })).toEqual({
      title: 'Delete "Fix login"?',
      description:
        'This removes the work item, its sessions, and its checkpoints from this machine, and deletes it for anyone it is shared with. The git branch and its commits stay in the repository.',
    });
  });

  it('names the checkpoints that go and the folder, files and branch that stay, for an adopted checkout', () => {
    const confirm = describeWorkItemDeleteConfirm({
      name: 'Ledger job migration',
      adopted: { path: 'C:\\code\\app\\.claude\\worktrees\\x', branch: 'claude/x' },
    });

    expect(confirm.title).toBe('Delete "Ledger job migration"?');
    expect(confirm.description).toContain('its checkpoints');
    expect(confirm.description).toContain('C:\\code\\app\\.claude\\worktrees\\x');
    expect(confirm.description).toContain('claude/x');
    expect(confirm.description).toMatch(/stay/);
    // Nothing in it suggests the folder is removed.
    expect(confirm.description).not.toMatch(/removes (its|the) (checkout|folder)/i);
  });
});
