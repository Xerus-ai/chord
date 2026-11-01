import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setMock: vi.fn(),
  whereMock: vi.fn(),
  runMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    update: mocks.updateMock,
  },
}));

const { recordGitOperationOutcome } = await import('./git-operation-status');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMock.mockReturnValue({ set: mocks.setMock });
  mocks.setMock.mockReturnValue({ where: mocks.whereMock });
  mocks.whereMock.mockReturnValue({ run: mocks.runMock });
});

describe('recordGitOperationOutcome', () => {
  it('records a failure with a timestamp', () => {
    recordGitOperationOutcome('wt-1', 'Command failed: git push');
    expect(mocks.setMock).toHaveBeenCalledWith(
      expect.objectContaining({ gitLastError: 'Command failed: git push' })
    );
    const [{ gitLastErrorAt }] = mocks.setMock.mock.calls[0];
    expect(typeof gitLastErrorAt).toBe('number');
    expect(mocks.runMock).toHaveBeenCalledTimes(1);
  });

  it('clears the failure on success', () => {
    recordGitOperationOutcome('wt-1', null);
    expect(mocks.setMock).toHaveBeenCalledWith({ gitLastError: null, gitLastErrorAt: null });
  });
});
