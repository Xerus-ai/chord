import { describe, expect, it } from 'vitest';
import { generateSkillMd, parseFrontmatter } from './validation';

const md = (frontmatter: string) => `---\n${frontmatter}\n---\n\n# Body\n`;

/**
 * devstation-4yp: Settings → Skills showed "beads >" — a SKILL.md whose
 * description is a YAML folded block (`description: >`) came back as the
 * marker itself. Real skills use every scalar style, so the parser reads them
 * all as YAML does.
 */
describe('parseFrontmatter', () => {
  it('folds a `>` block into one line', () => {
    const { frontmatter } = parseFrontmatter(
      md(
        [
          'name: beads',
          'description: >',
          '  Tracks complex, multi-session work using the Beads issue tracker.',
          '  Use when work spans multiple sessions: "create task for".',
        ].join('\n')
      )
    );
    expect(frontmatter.name).toBe('beads');
    expect(frontmatter.description).toBe(
      'Tracks complex, multi-session work using the Beads issue tracker. Use when work spans multiple sessions: "create task for".'
    );
  });

  it('keeps the line breaks of a `|` block', () => {
    const { frontmatter } = parseFrontmatter(
      md(['name: x', 'description: |-', '  First line.', '  Second line.'].join('\n'))
    );
    expect(frontmatter.description).toBe('First line.\nSecond line.');
  });

  it('turns a blank line inside a folded block into a line break', () => {
    const { frontmatter } = parseFrontmatter(
      md(['description: >-', '  One.', '', '  Two.', 'name: y'].join('\n'))
    );
    expect(frontmatter.description).toBe('One.\nTwo.');
    expect(frontmatter.name).toBe('y');
  });

  it('never reads a colon inside a block as a key of its own', () => {
    const { frontmatter } = parseFrontmatter(
      md(['description: >', '  Triggers on: idea evaluation', 'name: critical-thinker'].join('\n'))
    );
    expect(frontmatter.description).toBe('Triggers on: idea evaluation');
    expect(frontmatter.name).toBe('critical-thinker');
    expect(frontmatter).not.toHaveProperty('Triggers on');
  });

  it('joins an unquoted value continued on indented lines', () => {
    const { frontmatter } = parseFrontmatter(
      md(['name: z', 'description: Starts here', '  and goes on.'].join('\n'))
    );
    expect(frontmatter.description).toBe('Starts here and goes on.');
  });

  it('reads CRLF files the same', () => {
    const { frontmatter } = parseFrontmatter(
      md(['name: w', 'description: >', '  Folded text.'].join('\n')).replace(/\n/g, '\r\n')
    );
    expect(frontmatter.description).toBe('Folded text.');
  });

  it('still unquotes plain single-line values', () => {
    const { frontmatter } = parseFrontmatter(
      md(['name: "quoted \\"name\\""', "description: 'it''s fine'"].join('\n'))
    );
    expect(frontmatter.name).toBe('quoted "name"');
    expect(frontmatter.description).toBe("it's fine");
  });

  it('reads back what generateSkillMd writes', () => {
    const { frontmatter, body } = parseFrontmatter(generateSkillMd('my-skill', 'Does: things'));
    expect(frontmatter).toMatchObject({ name: 'my-skill', description: 'Does: things' });
    expect(body).toContain('# my-skill');
  });
});
