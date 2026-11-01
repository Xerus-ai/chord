import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_INLINE_PROMPT_CHARS = 16_384;

const TEMP_DIR_PREFIX = 'chord-prompt-';
const CONTEXT_FILE_NAME = 'task-context.md';
const LINE_BREAK = /[\r\n]/;

type SpillReason = 'too_large' | 'line_breaks';

function buildPromptPointerMessage(filePath: string, reason: SpillReason): string {
  const why =
    reason === 'too_large'
      ? 'The full task context was too large to pass on the command line'
      : "The task has line breaks, which this agent's command line cannot carry";
  return `${why}, so it has been written to a file. Read the file at ${filePath} and complete the task described in it.`;
}

export type SpillResult = {
  prompt: string;
  cleanup: () => Promise<void>;
};

const noopCleanup = (): Promise<void> => Promise.resolve();

/**
 * The first prompt as an agent CLI's argument: as typed when the command line
 * can carry it, otherwise written to a file the agent is told to read — never
 * cut short. `lineBreaksAllowed` is false where the agent launches through
 * cmd.exe, whose command line ends at a line break (devstation-9ge).
 */
export async function spillPromptForCommandLine(
  prompt: string,
  { lineBreaksAllowed }: { lineBreaksAllowed: boolean }
): Promise<SpillResult> {
  const reason: SpillReason | null =
    prompt.length > MAX_INLINE_PROMPT_CHARS
      ? 'too_large'
      : !lineBreaksAllowed && LINE_BREAK.test(prompt)
        ? 'line_breaks'
        : null;
  if (!reason) return { prompt, cleanup: noopCleanup };

  const dir = await mkdtemp(join(tmpdir(), TEMP_DIR_PREFIX));
  const filePath = join(dir, CONTEXT_FILE_NAME);
  try {
    await writeFile(filePath, prompt, 'utf8');
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    prompt: buildPromptPointerMessage(filePath, reason),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
