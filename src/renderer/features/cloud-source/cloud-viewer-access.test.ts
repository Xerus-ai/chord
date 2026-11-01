import { describe, expect, it } from 'vitest';
import { cloudViewerAccess } from './cloud-viewer-access';

const item = (caller_role: 'author' | 'edit' | 'view', approval_policy = 'owner') => ({
  id: 'wi-1',
  caller_role,
  approval_policy,
});

/** Who a cloud work item's viewer is, from the item and the live role (step 4, S4 and S5c). */
describe('cloudViewerAccess', () => {
  it('reads the author, on another machine, as a member with edit', () => {
    expect(cloudViewerAccess(item('author'), null)).toEqual({
      viewer: 'member',
      role: 'edit',
      scope: 'work_item',
      approvalPolicy: 'owner',
      author: true,
    });
    expect(cloudViewerAccess(item('edit'), null).author).toBe(false);
  });

  it('reads Can view and Can edit, and the delegated policy', () => {
    expect(cloudViewerAccess(item('view'), null).role).toBe('view');
    expect(cloudViewerAccess(item('edit', 'participants'), null)).toMatchObject({
      role: 'edit',
      approvalPolicy: 'participants',
    });
  });

  it('takes a live role change over the role the item was read with', () => {
    expect(cloudViewerAccess(item('edit'), 'view').role).toBe('view');
    expect(cloudViewerAccess(item('view'), 'edit').role).toBe('edit');
  });

  it('throws for an item read without the caller role', () => {
    expect(() =>
      cloudViewerAccess({ id: 'wi-1', caller_role: undefined, approval_policy: 'owner' }, null)
    ).toThrow();
  });
});
