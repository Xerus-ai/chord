import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** One prompt to one agent; `signal` cancels it. */
export interface OneShotRequest {
  prompt: string;
  /** A model id from the agent's catalog; null = its default. */
  model: string | null;
  signal: AbortSignal;
}

/** The folder name prefix of every run, so a leftover is recognisable. */
export const RUN_FOLDER_PREFIX = 'chord-git-ai-run-';

/**
 * Runs `work` in a fresh empty folder, removed afterwards: an agent that
 * somehow had file access would find nothing, and a session an agent records
 * by cwd is never one of a lane's.
 */
export async function withRunFolder<T>(work: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(path.join(tmpdir(), RUN_FOLDER_PREFIX));
  try {
    return await work(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
