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

// Pulled in transitively by persist-agent-turn.ts for persistCompletedTurn;
// its module graph reaches the account service, which requires a real
// Electron `app`. recordSessionTurnOutcome never calls it, so a stub avoids
// that entirely.
vi.mock('@main/core/work-items/sync-queue-service', () => ({
  syncQueueService: { enqueueChatMessages: vi.fn() },
}));

const { recordSessionTurnOutcome } = await import('./persist-agent-turn');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMock.mockReturnValue({ set: mocks.setMock });
  mocks.setMock.mockReturnValue({ where: mocks.whereMock });
  mocks.whereMock.mockReturnValue({ run: mocks.runMock });
});

describe('recordSessionTurnOutcome', () => {
  it('does nothing without a session id', () => {
    recordSessionTurnOutcome(null, true);
    expect(mocks.updateMock).not.toHaveBeenCalled();
  });

  it('sets lastTurnStatus to error when the turn errored', () => {
    recordSessionTurnOutcome('session-1', true);
    expect(mocks.updateMock).toHaveBeenCalledTimes(1);
    expect(mocks.setMock).toHaveBeenCalledWith(
      expect.objectContaining({ lastTurnStatus: 'error' })
    );
    expect(mocks.runMock).toHaveBeenCalledTimes(1);
  });

  it('clears lastTurnStatus to null when the turn completed cleanly', () => {
    recordSessionTurnOutcome('session-1', false);
    expect(mocks.setMock).toHaveBeenCalledWith(expect.objectContaining({ lastTurnStatus: null }));
  });
});
