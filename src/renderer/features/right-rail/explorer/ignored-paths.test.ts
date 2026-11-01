import { describe, expect, it } from 'vitest';
import { buildIgnoredMatcher } from './ignored-paths';

describe('buildIgnoredMatcher', () => {
  it('matches a file git listed by name', () => {
    const isIgnored = buildIgnoredMatcher(['bash.exe.stackdump']);
    expect(isIgnored('bash.exe.stackdump')).toBe(true);
    expect(isIgnored('bash.exe.stackdump.txt')).toBe(false);
  });

  it('matches everything under a directory git collapsed with --directory', () => {
    const isIgnored = buildIgnoredMatcher(['node_modules/']);
    expect(isIgnored('node_modules')).toBe(true);
    expect(isIgnored('node_modules/react')).toBe(true);
    expect(isIgnored('node_modules/react/index.js')).toBe(true);
  });

  it('does not let a prefix match half a name', () => {
    const isIgnored = buildIgnoredMatcher(['out/']);
    expect(isIgnored('outbox')).toBe(false);
    expect(isIgnored('outbox/note.md')).toBe(false);
    expect(isIgnored('out/main.js')).toBe(true);
  });

  it('ignores nothing when git listed nothing', () => {
    const isIgnored = buildIgnoredMatcher([]);
    expect(isIgnored('anything')).toBe(false);
  });

  it('reads a nested ignored directory', () => {
    const isIgnored = buildIgnoredMatcher(['src/generated/']);
    expect(isIgnored('src/generated/api.ts')).toBe(true);
    expect(isIgnored('src/generator.ts')).toBe(false);
  });
});
