import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_INLINE_PROMPT_CHARS,
  spillPromptForCommandLine,
  type SpillResult,
} from './spill-prompt';

/**
 * A first prompt goes to an agent CLI as an argument. One the command line
 * cannot carry as typed goes in a file instead, and the agent is told to read
 * it: too large for any command line, or — through cmd.exe, which ends its
 * line at a line break (devstation-9ge) — one with line breaks. Never cut short.
 */
const spills: SpillResult[] = [];
afterEach(async () => {
  for (const spill of spills.splice(0)) await spill.cleanup();
});

async function spill(prompt: string, lineBreaksAllowed: boolean): Promise<SpillResult> {
  const result = await spillPromptForCommandLine(prompt, { lineBreaksAllowed });
  spills.push(result);
  return result;
}

function spilledFile(result: SpillResult): string {
  const match = /Read the file at (.+?) and complete/.exec(result.prompt);
  expect(match, result.prompt).not.toBeNull();
  return match![1];
}

describe('spillPromptForCommandLine', () => {
  it('keeps a one-line prompt inline', async () => {
    expect((await spill('Fix the "login" bug & 100% of tests', false)).prompt).toBe(
      'Fix the "login" bug & 100% of tests'
    );
  });

  it('keeps a multi-line prompt inline where the command line carries line breaks', async () => {
    expect((await spill('Fix the bug.\nThen run the tests.', true)).prompt).toBe(
      'Fix the bug.\nThen run the tests.'
    );
  });

  it('writes a multi-line prompt to a file, exactly, where the command line cannot carry it', async () => {
    const prompt = 'Fix the bug.\r\n\r\n```ts\nconst a = "b";\n```\nThen run the tests.';
    const result = await spill(prompt, false);

    expect(result.prompt).not.toMatch(/[\r\n]/);
    expect(result.prompt).toMatch(/line breaks/);
    expect(readFileSync(spilledFile(result), 'utf8')).toBe(prompt);
  });

  it('writes a prompt too large for any command line to a file', async () => {
    const prompt = 'x'.repeat(MAX_INLINE_PROMPT_CHARS + 1);
    const result = await spill(prompt, true);

    expect(result.prompt).toMatch(/too large/);
    expect(readFileSync(spilledFile(result), 'utf8')).toBe(prompt);
  });

  it('removes the file on cleanup', async () => {
    const result = await spillPromptForCommandLine('one\ntwo', { lineBreaksAllowed: false });
    const file = spilledFile(result);

    await result.cleanup();

    expect(existsSync(file)).toBe(false);
  });
});
