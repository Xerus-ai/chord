import { describe, expect, it } from 'vitest';
import { resolveCatalogSourceIcon, resolveSkillIcon } from './skillIcons';

describe('resolveSkillIcon', () => {
  it('resolves a bundled SVG for an explicitly mapped skill', () => {
    const svg = resolveSkillIcon('jupyter-notebook', 'openai');
    expect(svg).toContain('<svg');
  });

  it('resolves a bundled SVG through a keyword rule', () => {
    const svg = resolveSkillIcon('gh-address-comments', 'openai');
    expect(svg).toContain('<svg');
  });

  it('falls back to the catalog source logo for an unmapped skill', () => {
    expect(resolveSkillIcon('some-unmapped-skill-id', 'anthropic')).toBe(
      resolveCatalogSourceIcon('anthropic')
    );
  });

  it('returns undefined when neither the skill nor its source has a bundled icon', () => {
    expect(resolveSkillIcon('some-unmapped-skill-id', 'local')).toBeUndefined();
  });
});

describe('resolveCatalogSourceIcon', () => {
  it('bundles logos for both remote catalogs', () => {
    expect(resolveCatalogSourceIcon('openai')).toContain('<svg');
    expect(resolveCatalogSourceIcon('anthropic')).toContain('<svg');
  });

  it('has no logo for locally authored skills', () => {
    expect(resolveCatalogSourceIcon('local')).toBeUndefined();
  });
});
