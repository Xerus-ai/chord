import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRISM_LANGUAGE_ALIASES, resolvePrismLanguage } from './prism-language';

/**
 * Code blocks load their grammar on first use (react-syntax-highlighter's
 * PrismAsyncLight), and its loaders are keyed by grammar name only: a fence
 * written ```ts or ```py found no loader and rendered plain, where the full
 * Prism build had resolved the alias (e2e perf-surfaces, 2026-10-15). The
 * alias table is refractor's own, so it is checked against refractor here.
 */
const ROOT = join(__dirname, '..', '..', '..', '..');

/** Every alias refractor's grammars declare, to the grammar that declares it. */
function readRefractorAliases(): Record<string, string> {
  const dir = join(ROOT, 'node_modules', 'refractor', 'lang');
  const aliases: Record<string, string> = {};
  for (const file of readdirSync(dir)) {
    const declared = /\.aliases = \[(.*?)\]/.exec(readFileSync(join(dir, file), 'utf8'));
    if (!declared) continue;
    for (const alias of declared[1].split(',')) {
      const name = alias.trim().replace(/'/g, '');
      if (name) aliases[name] = file.replace(/\.js$/, '');
    }
  }
  return aliases;
}

describe('resolvePrismLanguage', () => {
  it('resolves the fence names agents write to the grammar that loads', () => {
    expect(resolvePrismLanguage('ts')).toBe('typescript');
    expect(resolvePrismLanguage('js')).toBe('javascript');
    expect(resolvePrismLanguage('py')).toBe('python');
    expect(resolvePrismLanguage('yml')).toBe('yaml');
    expect(resolvePrismLanguage('shell')).toBe('bash');
    expect(resolvePrismLanguage('html')).toBe('markup');
  });

  it('keeps a grammar name, and any case, as written', () => {
    expect(resolvePrismLanguage('typescript')).toBe('typescript');
    expect(resolvePrismLanguage('TS')).toBe('typescript');
    expect(resolvePrismLanguage('rust')).toBe('rust');
  });

  it('carries exactly the aliases refractor declares', () => {
    expect(PRISM_LANGUAGE_ALIASES).toEqual(readRefractorAliases());
  });
});
