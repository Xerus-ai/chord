import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Two CI steps need more than Node's default old space on the runner (about 2 GB): the renderer
 * bundle, and eslint with typed linting, which passes at 2 GB and runs out at 1.5 GB
 * (devstation-rf8r). Run on the default, the lint step crashed with "heap out of memory" in about
 * one run in ten. ci.yml is read as text: a step is a `- ` item at the steps' indent.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ci = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const HEAP = 'NODE_OPTIONS: --max-old-space-size=4096';

function stepsRunning(command: string): string[] {
  return ci
    .split(/\n(?= {6}- )/)
    .filter((step) => new RegExp(`run: ${command}\\s*$`, 'm').test(step));
}

describe('CI steps that need more than the default heap get 4 GB', () => {
  it.each(['pnpm run lint', 'pnpm run build'])('%s', (command) => {
    const steps = stepsRunning(command);

    expect(steps).not.toHaveLength(0);
    for (const step of steps) expect(step).toContain(HEAP);
  });
});
