import type { SkillFrontmatter } from './types';

/** Validate a skill name: lowercase, hyphens, 1-64 chars */
export function isValidSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]?$/.test(name) && !name.includes('--');
}

const isIndented = (line: string) => /^[ \t]/.test(line);

/**
 * A block scalar's text: `|` keeps its line breaks; `>` folds lines into one,
 * a blank line becoming a break. The common indentation is not part of the
 * text, and neither are the leading and trailing blank lines.
 */
function readBlockScalar(lines: string[], style: '>' | '|'): string {
  const trimmed = lines.map((line) => line.replace(/\s+$/, ''));
  const indents = trimmed.filter(Boolean).map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  const text = trimmed.map((line) => line.slice(indent));
  if (style === '|') return text.join('\n').trim();

  let folded = '';
  for (const line of text) {
    if (line === '') folded += '\n';
    else folded += folded === '' || folded.endsWith('\n') ? line : ` ${line}`;
  }
  return folded.trim();
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/**
 * Parse YAML frontmatter from SKILL.md content: one `key: value` per
 * top-level line, where a value is quoted, plain (continued on indented
 * lines), or a `>` / `|` block scalar. Indented lines always belong to the
 * key above them — a description reading "Triggers on: …" is text, not a
 * key. Block scalars were returned as their marker, and Settings → Skills
 * showed "beads >" (devstation-4yp).
 */
export function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: { name: '', description: '' },
      body: content,
    };
  }

  const lines = match[1].split(/\r?\n/);
  const body = match[2];
  const frontmatter: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isIndented(line) || line.trimStart().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 1).trim();

    // Every indented or blank line up to the next key continues this value.
    const continuation: string[] = [];
    while (i + 1 < lines.length && (isIndented(lines[i + 1]) || lines[i + 1].trim() === '')) {
      continuation.push(lines[++i]);
    }

    const block = raw.match(/^([>|])[+-]?$/);
    let value: string;
    if (block) {
      value = readBlockScalar(continuation, block[1] as '>' | '|');
    } else {
      const rest = continuation.map((l) => l.trim()).filter(Boolean);
      value = unquote([raw, ...rest].filter(Boolean).join(' '));
    }
    if (key) {
      frontmatter[key] = value;
    }
  }

  return {
    frontmatter: {
      name: frontmatter['name'] || '',
      description: frontmatter['description'] || '',
      license: frontmatter['license'],
      compatibility: frontmatter['compatibility'],
      'allowed-tools': frontmatter['allowed-tools'],
    },
    body,
  };
}

function escapeYamlDoubleQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function generateSkillMd(name: string, description: string, body?: string): string {
  const escapedName = escapeYamlDoubleQuoted(name);
  const escapedDesc = escapeYamlDoubleQuoted(description);
  const defaultBody = `# ${name}\n\n${description}\n`;
  const content = body && body.trim() ? body.trim() : defaultBody;
  return `---
name: "${escapedName}"
description: "${escapedDesc}"
---

${content}
`;
}
