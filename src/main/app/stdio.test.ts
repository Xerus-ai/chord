import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const STDIO_MODULE = new URL('./stdio.ts', import.meta.url).href;

/**
 * Runs a real Node process that keeps writing to stdout after the parent has
 * closed its end of the pipe, the way an e2e runner that is killed leaves an
 * app it launched.
 */
function runWriterAfterReaderCloses(
  guarded: boolean
): Promise<{ code: number | null; stderr: string }> {
  const script = [
    `import { ignoreClosedStdioReaders } from ${JSON.stringify(STDIO_MODULE)};`,
    guarded ? 'ignoreClosedStdioReaders();' : '',
    `process.stdout.write('ready\\n');`,
    `const timer = setInterval(() => process.stdout.write('still logging\\n'), 20);`,
    `setTimeout(() => { clearInterval(timer); process.exit(0); }, 1000);`,
  ].join('\n');

  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdout.once('data', () => child.stdout.destroy());

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stderr }));
  });
}

describe('ignoreClosedStdioReaders', () => {
  it('an unguarded process dies with EPIPE once its stdout reader closes', async () => {
    const result = await runWriterAfterReaderCloses(false);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('EPIPE');
  });

  it('a guarded process keeps running and exits normally', async () => {
    const result = await runWriterAfterReaderCloses(true);

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });
});
