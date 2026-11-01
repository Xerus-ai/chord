import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CI runs on named runner images (devstation-0ttv). `ubuntu-latest` moved from ubuntu-24.04 to
 * ubuntu-26.04, where the locked Playwright cannot install chromium, and every PR's Linux job
 * failed before a test ran. Moving an image is a reviewed change, not something GitHub does.
 */
const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows');

/** Every `runs-on:` value, without a trailing comment or quotes; a list keeps its brackets. */
function readRunnerLabels(text: string) {
  return [...text.matchAll(/^\s*runs-on:(.*)$/gm)].map((m) =>
    m[1]
      .replace(/\s#.*$/, '')
      .replace(/["']/g, '')
      .trim()
  );
}

const hasLatestLabel = (label: string) => /(^|[\s,[])[\w.-]+-latest\b/.test(label);

describe('CI runner images', () => {
  it('every job runs on a named image, none on a -latest label', () => {
    const labels = readdirSync(WORKFLOWS)
      .filter((name) => /\.ya?ml$/.test(name))
      .flatMap((name) =>
        readRunnerLabels(readFileSync(join(WORKFLOWS, name), 'utf8')).map((l) => `${name}: ${l}`)
      );

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.filter(hasLatestLabel)).toEqual([]);
  });

  it('reads a label behind quotes, a comment or a list', () => {
    const text = [
      '    runs-on: "ubuntu-latest"',
      "    runs-on: 'windows-latest' # the build",
      '    runs-on: [self-hosted, macos-latest]',
      '    runs-on: ubuntu-24.04 # not latest',
    ].join('\n');

    expect(readRunnerLabels(text).map(hasLatestLabel)).toEqual([true, true, true, false]);
  });
});
