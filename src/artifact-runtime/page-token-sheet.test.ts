import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generatePageTokenSheet } from '../../scripts/artifact-runtime/generate-page-tokens.mjs';

const indexCss = readFileSync(
  fileURLToPath(new URL('../renderer/index.css', import.meta.url)),
  'utf8'
);

/** The declarations inside `<selector>{...}` of the generated sheet. */
function ruleBody(sheet: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.:]/g, '\\$&');
  const match = sheet.match(new RegExp(`(?:^|\\n)${escaped}\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule ${selector} not found in sheet`);
  const decls = new Map<string, string>();
  for (const d of match[1].matchAll(/([a-z-]+)\s*:([^;]*);/g)) decls.set(d[1], d[2].trim());
  return decls;
}

/** The value index.css declares for `token` inside the `.name { ... }` theme block. */
function themeValue(name: string, token: string): string {
  const block = indexCss.match(new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  if (!block) throw new Error(`.${name} block not found in index.css`);
  const decl = block[1].match(new RegExp(`(?:^|[;{\\s])${token}\\s*:([^;}]*)`));
  if (!decl) throw new Error(`${token} not declared in .${name}`);
  return decl[1].trim();
}

describe('generatePageTokenSheet', () => {
  const sheet = generatePageTokenSheet(indexCss);

  it('starts with the generated-file banner and ends with a newline', () => {
    expect(sheet.startsWith('/* generated from src/renderer/index.css — do not edit */\n')).toBe(
      true
    );
    expect(sheet.endsWith('\n')).toBe(true);
  });

  it.each(['chord-dark', 'chord-light'])('copies the core tokens into .%s verbatim', (name) => {
    const body = ruleBody(sheet, `.${name}`);
    for (const token of [
      '--surface',
      '--text',
      '--border',
      '--action-bg',
      '--status-ok',
      '--radius',
    ]) {
      expect(body.get(token)).toBe(themeValue(name, token));
    }
    expect(body.get('color-scheme')).toBe(name === 'chord-dark' ? 'dark' : 'light');
  });

  it('emits no type-scale sizes and no non-page families', () => {
    expect(sheet).not.toMatch(/--text-body\b/);
    expect(sheet).not.toMatch(/--text-title\b/);
    expect(sheet).not.toMatch(/--identity-/);
    expect(sheet).not.toMatch(/--monaco-/);
  });

  it('carries font stacks and the radius ramp in :root', () => {
    const root = ruleBody(sheet, ':root');
    expect(root.get('--font-sans')).toContain('system-ui');
    expect(root.get('--font-mono')).toContain('monospace');
    expect(root.get('--radius-lg')).toBe('var(--radius)');
    expect(root.get('--radius-md')).toBe('calc(var(--radius) - 2px)');
  });

  it('never emits a hex colour that index.css does not contain', () => {
    const hexes = sheet.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(indexCss).toContain(hex);
  });

  it('is deterministic', () => {
    expect(generatePageTokenSheet(indexCss)).toBe(sheet);
  });
});

describe('generatePageTokenSheet fail-fast', () => {
  const themeBlock = (name: string, extra = '') => `
  .${name} {
    color-scheme: ${name === 'chord-dark' ? 'dark' : 'light'};
    --surface: #111111;
    --text: #eeeeee;
    --text-muted: #cccccc;
    --text-passive: #999999;
    --text-disabled: #555555;
    --border: #333333;
    --action-bg: #222222;
    --selected-bg: #444444;
    --focus-ring: #cccccc;
    --selection-bg: #666666;
    --status-ok: #00aa00;
    --radius: 10px;
    --shadow-sm: 0 1px 2px #000000;${extra}
  }`;
  const themeInline = `@theme inline {
  --font-sans: system-ui, sans-serif;
  --radius-lg: var(--radius);
}`;

  it('accepts a minimal well-formed sheet', () => {
    const css = `${themeInline}\n@layer base {${themeBlock('chord-dark')}${themeBlock('chord-light')}\n}\n`;
    expect(() => generatePageTokenSheet(css)).not.toThrow();
  });

  it('throws when .chord-light is missing', () => {
    const css = `${themeInline}\n@layer base {${themeBlock('chord-dark')}\n}\n`;
    expect(() => generatePageTokenSheet(css)).toThrow(/chord-light/);
  });

  it('throws when dark declares a surface token light lacks', () => {
    const css = `${themeInline}\n@layer base {${themeBlock('chord-dark', '\n    --surface-x: #121212;')}${themeBlock('chord-light')}\n}\n`;
    expect(() => generatePageTokenSheet(css)).toThrow(/--surface-x/);
  });
});
