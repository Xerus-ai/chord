/**
 * Page token sheet: the subset of the renderer's design tokens that a
 * sandboxed artifact page may use, derived from src/renderer/index.css.
 *
 * Pages run in a sandbox and cannot read the renderer's CSS, so the host
 * injects this sheet as their first stylesheet. It is generated, never hand
 * kept, so scripts/token-audit.mjs stays the single colour gate: every value
 * here is copied verbatim from index.css.
 *
 * Theme blocks are located with the same pattern token-audit uses
 * (`.chord-dark {` ... the first `}` on its own line), so the two agree on
 * what a theme block contains.
 */

export const BANNER = '/* generated from src/renderer/index.css — do not edit */';

const THEMES = /** @type {const} */ ([
  { name: 'chord-dark', scheme: 'dark' },
  { name: 'chord-light', scheme: 'light' },
]);

/**
 * Token families a page may use. `exact` families name one token; prefix
 * families match every token that starts with the prefix. Each family must
 * match at least one token in each theme block.
 */
const THEME_FAMILIES = [
  { label: '--surface', test: (t) => t === '--surface' || t.startsWith('--surface-') },
  { label: '--text', test: (t) => t === '--text' },
  { label: '--text-muted', test: (t) => t === '--text-muted' },
  { label: '--text-passive', test: (t) => t === '--text-passive' },
  { label: '--text-disabled', test: (t) => t === '--text-disabled' },
  { label: '--border', test: (t) => t === '--border' || t.startsWith('--border-') },
  { label: '--action-*', test: (t) => t.startsWith('--action-') },
  { label: '--selected-*', test: (t) => t.startsWith('--selected-') },
  { label: '--focus-ring', test: (t) => t === '--focus-ring' },
  { label: '--selection-bg', test: (t) => t === '--selection-bg' },
  { label: '--status-*', test: (t) => t.startsWith('--status-') },
  { label: '--radius', test: (t) => t === '--radius' },
  { label: '--shadow-*', test: (t) => t.startsWith('--shadow-') },
];

/** `@theme inline` families that are theme-independent and go in `:root`. */
const ROOT_FAMILIES = [
  { label: '--font-*', test: (t) => t.startsWith('--font-') },
  { label: '--radius-*', test: (t) => t.startsWith('--radius-') },
];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Collapse a (possibly multi-line) declaration value onto one line. */
const normaliseValue = (value) => value.trim().replace(/\s+/g, ' ');

/** Every `--x: value` in `text`, in token-audit's declaration grammar. */
function declarations(text) {
  const out = new Map();
  for (const m of text.matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:([^;}]*)/gim)) {
    if (out.has(m[1])) throw new Error(`page tokens: ${m[1]} is declared twice in one block`);
    out.set(m[1], normaliseValue(m[2]));
  }
  return out;
}

function themeBlock(css, name) {
  const re = new RegExp(`\\.${name}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'g');
  const matches = [...css.matchAll(re)];
  if (matches.length === 0) throw new Error(`page tokens: no .${name} theme block in index.css`);
  if (matches.length > 1) {
    throw new Error(
      `page tokens: ${matches.length} .${name} theme blocks in index.css, expected 1`
    );
  }
  const body = matches[0][1];
  const scheme = body.match(/(?:^|[;{])\s*color-scheme\s*:([^;}]*)/m);
  if (!scheme) throw new Error(`page tokens: .${name} declares no color-scheme`);
  return { tokens: declarations(body), colorScheme: normaliseValue(scheme[1]) };
}

/** Declarations at the top level of `@theme inline { ... }`, nested rules excluded. */
function themeInlineDeclarations(css) {
  const start = css.indexOf('@theme inline {');
  if (start === -1) throw new Error('page tokens: no `@theme inline` block in index.css');
  let depth = 0;
  let topLevel = '';
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return declarations(topLevel);
      if (depth === 1) topLevel += ';';
      continue;
    }
    if (depth === 1) topLevel += ch;
  }
  throw new Error('page tokens: `@theme inline` block is not closed');
}

function selectFamilies(tokens, families, where) {
  const selected = new Map();
  for (const family of families) {
    const hits = [...tokens.keys()].filter(family.test);
    if (hits.length === 0)
      throw new Error(`page tokens: ${family.label} matches nothing in ${where}`);
    for (const t of hits) selected.set(t, tokens.get(t));
  }
  return selected;
}

function assertParity(dark, light) {
  const onlyDark = [...dark.keys()].filter((t) => !light.has(t));
  const onlyLight = [...light.keys()].filter((t) => !dark.has(t));
  if (onlyDark.length || onlyLight.length) {
    throw new Error(
      'page tokens: theme blocks disagree on page tokens — ' +
        `only in .chord-dark: [${onlyDark.join(', ')}]; only in .chord-light: [${onlyLight.join(', ')}]`
    );
  }
}

/** Every var() a theme value reaches for must itself be emitted in that theme. */
function assertThemeReferencesEmitted(selected, where) {
  for (const [token, value] of selected) {
    for (const ref of value.matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (!selected.has(ref[1])) {
        throw new Error(
          `page tokens: ${token} in ${where} references ${ref[1]}, which is not emitted`
        );
      }
    }
  }
}

/**
 * Resolve `:root` values. A `var(--x)` stays if `--x` is emitted. Otherwise a
 * value that is exactly `var(--x)` is replaced by `--x`'s theme-independent
 * `@theme` value; anything else is an error, because inlining inside a larger
 * expression would write a value that index.css does not contain.
 */
function resolveRootValues(rootTokens, themeInline, emitted) {
  const resolved = new Map();
  for (const [token, value] of rootTokens) {
    const refs = [...value.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    const missing = refs.filter((r) => !emitted.has(r));
    if (missing.length === 0) {
      resolved.set(token, value);
      continue;
    }
    const whole = value.match(/^var\((--[a-z0-9-]+)\)$/);
    const target = whole && themeInline.get(whole[1]);
    if (!target || /var\(/.test(target)) {
      throw new Error(
        `page tokens: ${token}: ${value} references [${missing.join(', ')}], ` +
          'which is not emitted and cannot be inlined verbatim'
      );
    }
    resolved.set(token, target);
  }
  return resolved;
}

function rule(selector, lines) {
  return `${selector}{\n${lines.map((l) => `  ${l};`).join('\n')}\n}`;
}

const sortedDeclarations = (tokens) =>
  [...tokens.keys()].sort().map((t) => `${t}: ${tokens.get(t)}`);

/**
 * @param {string} indexCssText the full text of src/renderer/index.css
 * @returns {string} the page token sheet
 */
export function generatePageTokenSheet(indexCssText) {
  const css = stripComments(indexCssText);

  const themes = THEMES.map(({ name, scheme }) => {
    const block = themeBlock(css, name);
    if (block.colorScheme !== scheme) {
      throw new Error(
        `page tokens: .${name} color-scheme is ${block.colorScheme}, expected ${scheme}`
      );
    }
    const selected = selectFamilies(block.tokens, THEME_FAMILIES, `.${name}`);
    assertThemeReferencesEmitted(selected, `.${name}`);
    return { name, colorScheme: block.colorScheme, selected };
  });
  assertParity(themes[0].selected, themes[1].selected);

  const themeInline = themeInlineDeclarations(css);
  const rootTokens = selectFamilies(themeInline, ROOT_FAMILIES, '@theme inline');
  const emitted = new Set([...themes[0].selected.keys(), ...rootTokens.keys()]);
  const root = resolveRootValues(rootTokens, themeInline, emitted);

  const rules = [
    rule(':root', sortedDeclarations(root)),
    ...themes.map((t) =>
      rule(`.${t.name}`, [`color-scheme: ${t.colorScheme}`, ...sortedDeclarations(t.selected)])
    ),
  ];
  return `${BANNER}\n${rules.join('\n\n')}\n`;
}
