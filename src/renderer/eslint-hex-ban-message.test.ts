import fs from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import eslintConfig from '@root/eslint.config';

const INDEX_CSS = fs.readFileSync(path.resolve(__dirname, 'index.css'), 'utf8');

type RestrictedSyntaxEntry = { selector: string; message: string };

/** Every `no-restricted-syntax` entry, across the config, that bans an inline hex colour. */
function collectHexBanEntries(): RestrictedSyntaxEntry[] {
  const entries = new Map<string, RestrictedSyntaxEntry>();
  for (const block of eslintConfig) {
    const rule = block.rules?.['no-restricted-syntax'];
    if (!Array.isArray(rule)) continue;
    for (const entry of rule.slice(1)) {
      if (typeof entry === 'object' && entry !== null && 'selector' in entry) {
        const { selector, message } = entry as RestrictedSyntaxEntry;
        if (selector.includes('\\[#')) entries.set(selector, { selector, message });
      }
    }
  }
  return [...entries.values()];
}

describe('inline-hex lint rule', () => {
  it('suggests only token classes index.css defines', () => {
    const messages = collectHexBanEntries().map((entry) => entry.message);
    expect(messages.length).toBeGreaterThan(0);

    for (const message of messages) {
      const suggested = message.match(/\b(?:bg|text|border)-[a-z0-9-]+/g) ?? [];
      expect(suggested.length).toBeGreaterThan(0);
      for (const className of suggested) {
        const token = className.replace(/^(?:bg|text|border)-/, '');
        expect(INDEX_CSS, `${className} has no --color-${token} in index.css`).toContain(
          `--color-${token}:`
        );
      }
    }
  });

  // Guards the message-only change: the selectors themselves must keep working.
  it('still flags an inline hex className, plain and in a template literal', () => {
    const entries = collectHexBanEntries();
    const linter = new Linter({ configType: 'flat' });
    const source = [
      'export const A = () => <div className="bg-[#161718]" />;',
      'export const B = () => <div className={`p-2 ${"text-[#abcdef]"}`} />;',
      'export const C = () => <div className="bg-surface-raised text-text-muted" />;',
    ].join('\n');

    const results = linter.verify(
      source,
      [
        {
          files: ['**/*.tsx'],
          languageOptions: {
            parser: tseslint.parser,
            parserOptions: { ecmaFeatures: { jsx: true } },
          },
          rules: { 'no-restricted-syntax': ['error', ...entries] },
        },
      ],
      'fixture.tsx'
    );

    // A literal inside a template matches both selectors, so count flagged lines.
    expect([...new Set(results.map((result) => result.line))]).toEqual([1, 2]);
  });
});
