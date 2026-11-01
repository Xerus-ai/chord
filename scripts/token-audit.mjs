#!/usr/bin/env node
/**
 * Colour-token audit. Arithmetic on the CSS, not taste.
 *
 *   node scripts/token-audit.mjs                 # audit the app
 *   node scripts/token-audit.mjs <file.html>     # audit a single-file prototype
 *
 * Checks, in the order the migration needs them
 * (the color token system design):
 *
 *   1. UNRESOLVED  every var(--x) resolves to a declaration
 *   2. UNUSED      every declared token is referenced outside the
 *                  declaration files
 *   3. HUE         no token outside --status-* / --diff-* / --identity-*
 *                  carries a hue (Rule 2 of the design)
 *   4. PARITY      both theme blocks declare identical token sets
 *   5. CONTRAST    (a) no fill token sits in a foreground property, and
 *                  (b) the palette's own fg/bg pairs clear their floor
 *   6. PAGE SHEET  every var() in the artifact-page runtime and the agent
 *                  guidance exists in the GENERATED page token sheet, which
 *                  is all a sandboxed page can see
 *
 * A token can be referenced three ways and all three count. Miss the third
 * and you will conclude that 42 live tokens are dead:
 *   - a Tailwind utility          bg-surface-raised
 *   - a CSS variable              var(--surface-raised)
 *   - a BARE STRING in TS         '--identity-3', `--identity-${n}`
 * The last one is how avatar-identity.ts and utils/color-palettes.ts work.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { generatePageTokenSheet } from './artifact-runtime/generate-page-tokens.mjs';

const DECL_FILES = ['index.css', 'tokens.css'];
const SRC_EXT = new Set(['.ts', '.tsx', '.css']);

// The agent's page guidance: the publish_artifact tool description.
const AGENT_ARTIFACT_GUIDANCE = 'src/main/core/agent-artifact-tools/artifact-tool-guidance.ts';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SRC_EXT.has(extname(p))) out.push(p);
  }
  return out;
}

/**
 * Rule 2 of the design, as arithmetic: hue is permitted only where colour IS
 * the information. Everything else — surfaces, text, borders, hover, cards,
 * buttons, selection, focus, shadows, scrims — must be achromatic in both
 * themes. The exemption is carried by the NAME, so a reviewer can see it
 * without resolving the value.
 */
const HUE_ALLOWED = [/^--(color-)?status-/, /^--(color-)?diff-/, /^--(color-)?identity-/];

/**
 * Channel spread, normalised to the 0-255 range — NOT HSL saturation. HSL
 * divides by the distance to the nearest extreme, so it explodes near white:
 * #f8f7fa is three points of spread and reads as pure grey, but HSL calls it
 * 23% saturated. Spread answers the question the rule actually asks, which is
 * "how far apart are the channels", and it answers it the same way at both
 * ends of the ramp.
 *
 * The scale carries a deliberate violet cast (the reference ground is R41 G40
 * B43) and its widest step, #bcbac2, lands at 3%. The green accent this
 * migration deleted, #20744a, was 33%. 8% clears the first by a factor of two
 * and catches the second four times over.
 */
const MAX_CHROME_SPREAD = 0.08;

function spreadOf(value) {
  const hex = value.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  const fn = value.match(/\brgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)/i);
  let rgb;
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (fn) {
    rgb = [fn[1], fn[2], fn[3]].map(Number);
  } else {
    // var(), color-mix(), transparent, currentColor, a shadow geometry: the
    // colour lives in another token, and that token is checked on its own.
    return null;
  }
  return (Math.max(...rgb) - Math.min(...rgb)) / 255;
}

/** Every `--x: <value>` pair, so the hue check can read values, not names. */
const declarationsIn = (css) => [...css.matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:([^;}]*)/gim)];

const COLOUR_VALUE =
  /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\bcolor-mix\(|\btransparent\b|\bcurrentColor\b/i;

/**
 * Which tokens this audit is allowed to call dead.
 *
 * The scope is COLOUR. The type scale, the tracking scale and the spacing
 * scale have their own dead entries; they are a different cleanup with a
 * different blast radius, and a colour gate that fails on them is a gate
 * nobody can turn on. They are still listed, just under a heading that does
 * not fail the build.
 *
 * A token counts as colour if it is a `@theme` colour mirror or if its value
 * is one — resolved through one hop of `var()`, which is how the derived
 * tokens are written.
 */
function colourTokens(css) {
  const values = new Map();
  for (const [, token, value] of declarationsIn(css)) values.set(token, value);
  const isColour = (token, depth = 0) => {
    if (token.startsWith('--color-')) return true;
    const value = values.get(token);
    if (value === undefined || depth > 3) return false;
    if (COLOUR_VALUE.test(value)) return true;
    const hop = value.match(/var\((--[a-z0-9-]+)/);
    return hop ? isColour(hop[1], depth + 1) : false;
  };
  return new Set([...values.keys()].filter((t) => isColour(t)));
}

function hueViolations(css) {
  const out = [];
  for (const [, token, value] of declarationsIn(css)) {
    if (HUE_ALLOWED.some((re) => re.test(token))) continue;
    const spread = spreadOf(value);
    if (spread !== null && spread > MAX_CHROME_SPREAD) {
      out.push(`${token} ${value.trim()} (channel spread ${(spread * 100).toFixed(0)}%)`);
    }
  }
  return [...new Set(out)];
}

const declaredIn = (css) => {
  const set = new Set();
  for (const m of css.matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/gim)) set.add(m[1]);
  return set;
};

/**
 * Tokens the app never declares because something else injects them at
 * runtime: Radix popper sizing, and inline style props. Referencing one is
 * not a broken reference.
 */
const RUNTIME_INJECTED = new Set([
  '--anchor-width',
  '--available-height',
  '--gap',
  '--directory',
  '--port',
  '--accordion-panel-height',
]);

const isTokenish = (t) => /^--[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(t);

const referencedIn = (text) => {
  const set = new Set();
  // A dynamic name (`--identity-${slot}`, `--control-h-${size}`) is recorded
  // as a FAMILY, so its members are neither flagged dead nor flagged broken.
  for (const m of text.matchAll(/(?:var\(|['"`])(--[a-z0-9-]+?)-?\$\{/g)) set.add(`${m[1]}-*`);
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)\s*[),]/g)) if (isTokenish(m[1])) set.add(m[1]);
  for (const m of text.matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) if (isTokenish(m[1])) set.add(m[1]);
  return set;
};

/**
 * Which Tailwind utility prefixes a `@theme` entry can be spelled with. The
 * namespace of the token decides this, and getting it wrong is the difference
 * between "41 dead tokens" and zero: `--text-title` is spelled `text-title`,
 * not `text-text-title`, so treating every token like a colour reports the
 * whole type scale as dead.
 *
 * A `--x--line-height` companion is never written directly — it rides along
 * with its `--x` font-size utility — so it is checked against the same name.
 */
const UTILITY_PREFIXES = [
  [
    /^--color-/,
    [
      'bg',
      'text',
      'border',
      'ring',
      'ring-offset',
      'fill',
      'stroke',
      'divide',
      'from',
      'to',
      'via',
      'shadow',
      'outline',
      'placeholder',
      'decoration',
      'accent',
      'caret',
    ],
  ],
  [/^--text-/, ['text']],
  [/^--font-/, ['font']],
  [/^--tracking-/, ['tracking']],
  [/^--leading-/, ['leading']],
  [/^--radius-/, ['rounded']],
  [/^--shadow-/, ['shadow']],
  [/^--animate-/, ['animate']],
  [
    /^--spacing-/,
    [
      'p',
      'px',
      'py',
      'pt',
      'pr',
      'pb',
      'pl',
      'm',
      'mx',
      'my',
      'mt',
      'mr',
      'mb',
      'ml',
      'w',
      'h',
      'size',
      'min-w',
      'min-h',
      'max-w',
      'max-h',
      'gap',
      'gap-x',
      'gap-y',
      'space-x',
      'space-y',
      'inset',
      'top',
      'right',
      'bottom',
      'left',
      'translate-x',
      'translate-y',
      'basis',
    ],
  ],
];

const utilityFor = (text, token) => {
  const name = token.replace(/--line-height$/, '');
  const entry = UTILITY_PREFIXES.find(([re]) => re.test(name));
  if (!entry) return false;
  const [re, prefixes] = entry;
  const bare = name.replace(re, '');
  return new RegExp(`(^|[^a-z0-9-])(${prefixes.join('|')})-${bare}([^a-z0-9-]|$)`, 'm').test(text);
};

/**
 * Check 5a — ROLE. A fill token used in a foreground property.
 *
 * This is the failure that actually shipped. Step 3 renamed
 * `--primary-button-background` to `--action-bg` faithfully, but three call
 * sites used it as `color:`. The old value was a green (#20744a) that worked
 * as text; the new one is an achromatic surface (#3e3d40) that renders at
 * 1.36:1 on the dark ground — invisible. Light was 12.42:1, so review saw
 * nothing.
 *
 * The HUE check cannot catch this: the token is correctly achromatic, it is
 * just in the wrong slot. Grey-on-grey is exactly the failure a hue gate is
 * blind to, which is the argument for this one existing.
 */
const FILL_TIER = /^--(color-)?(surface|border|action-bg|selected-bg|scrim|overlay)/;

/** Properties that paint the GLYPH. `accent-color` is deliberately absent: it
 *  sets a control's fill, so `--action-bg` is correct there. */
const FG_PROPS = [
  'color',
  '-webkit-text-fill-color',
  'fill',
  'stroke',
  'caret-color',
  'text-decoration-color',
];

function roleViolations(css, sourceText) {
  const out = [];
  const prop = FG_PROPS.join('|');
  // CSS: `color: var(--surface-raised)`
  const re = new RegExp(`(?:^|[;{\\s])(${prop})\\s*:\\s*var\\((--[a-z0-9-]+)`, 'gim');
  for (const m of css.matchAll(re)) {
    if (FILL_TIER.test(m[2])) out.push(`${m[1]}: var(${m[2]})`);
  }
  // Tailwind: `text-surface-raised`, `fill-action-bg`, `text-[var(--surface)]`
  // `fill`/`stroke` are absent on purpose: an SVG shape legitimately takes a
  // surface colour (the tooltip arrow is the popup's own background continuing
  // into a pointer, `bg-action-bg fill-action-bg`). Restricting the check to
  // properties that paint TEXT keeps it free of false positives, which is what
  // decides whether a gate stays switched on.
  const utilPrefixes = ['text', 'caret', 'decoration'];
  for (const m of sourceText.matchAll(
    new RegExp(`(?:^|[^a-z0-9-])(${utilPrefixes.join('|')})-\\[var\\((--[a-z0-9-]+)`, 'gim')
  )) {
    if (FILL_TIER.test(m[2])) out.push(`${m[1]}-[var(${m[2]})]`);
  }
  for (const m of sourceText.matchAll(
    new RegExp(
      `(?:^|[^a-z0-9-])(${utilPrefixes.join('|')})-((?:surface|action-bg|selected-bg)[a-z0-9-]*)`,
      'gim'
    )
  )) {
    out.push(`${m[1]}-${m[2]}`);
  }
  return [...new Set(out)];
}

/* ---- Check 5b — PAIR. The palette's own contrast. ---- */

const srgb = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const luminance = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

const hexOf = (value) => {
  const m = (value || '').match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** Resolve a token to an opaque hex within one theme, following var() hops.
 *  An rgba()/color-mix() overlay has no fixed value — it composites onto
 *  whatever is beneath — so it is skipped rather than guessed at. */
function resolve(values, token, depth = 0) {
  if (depth > 4) return null;
  const v = values.get(token);
  if (v === undefined) return null;
  const direct = hexOf(v);
  if (direct) return direct;
  const hop = v.match(/var\((--[a-z0-9-]+)/);
  return hop ? resolve(values, hop[1], depth + 1) : null;
}

/**
 * Floors are set AT the shipped design, not above it, so the gate encodes
 * what was agreed rather than an aspiration that fails on day one. Measured
 * at the time of writing: worst --text-passive 4.63, worst signal (excluding
 * the idle dot) 4.54, --action-fg on --action-bg 9.03.
 */
/* --text-passive measures 4.08-4.65 across the four surfaces, i.e. the design
 * puts it just UNDER WCAG AA (4.5) on the secondary surfaces. The floor
 * records that rather than overriding it: this gate exists to catch a
 * regression, not to re-litigate the palette. Raising passive text to AA is a
 * palette decision, and it is noted in the plan's open questions. */
const TEXT_FLOOR = { '--text': 7, '--text-muted': 7, '--text-passive': 4.0 };
const SIGNAL_FLOOR = 3;
/** The idle dot is deliberately recessive — it means "nothing is happening",
 *  and at 2.87 it is the one signal colour that is not trying to be read. */
const SIGNAL_EXEMPT = new Set(['--status-idle']);

function pairViolations(themeValues) {
  const out = [];
  for (const [theme, values] of Object.entries(themeValues)) {
    const surfaces = [...values.keys()].filter((t) =>
      /^--surface(-(raised|inset|canvas))?$/.test(t)
    );
    const check = (fg, bg, floor, label) => {
      const f = resolve(values, fg);
      const b = resolve(values, bg);
      if (!f || !b) return;
      const ratio = contrast(f, b);
      if (ratio < floor) {
        out.push(`${theme}: ${label} ${ratio.toFixed(2)}:1 (floor ${floor})  ${fg} on ${bg}`);
      }
    };
    for (const [token, floor] of Object.entries(TEXT_FLOOR)) {
      for (const s of surfaces) check(token, s, floor, 'text');
    }
    for (const token of values.keys()) {
      if (!/^--(status|diff)-/.test(token) || SIGNAL_EXEMPT.has(token)) continue;
      check(token, '--surface', SIGNAL_FLOOR, 'signal');
    }
    check('--action-fg', '--action-bg', 4.5, 'action');
  }
  return out;
}

/** Theme blocks again, but keeping VALUES — check 5b needs to do arithmetic. */
function themeValueBlocks(css) {
  const out = {};
  const re = /(?:\[data-theme='([a-z]+)'\]|\.(chord-dark|chord-light))\s*\{([\s\S]*?)\n\s*\}/g;
  for (const m of css.matchAll(re)) {
    const name = m[1] ?? m[2];
    out[name] ??= new Map();
    for (const d of m[3].matchAll(/(--[a-z0-9-]+)\s*:([^;}]*)/gi)) out[name].set(d[1], d[2].trim());
  }
  return out;
}

function themeBlocks(css) {
  const out = {};
  const re = /(?:\[data-theme='([a-z]+)'\]|\.(chord-dark|chord-light))\s*\{([\s\S]*?)\n\s*\}/g;
  for (const m of css.matchAll(re)) {
    const name = m[1] ?? m[2];
    out[name] ??= new Set();
    for (const d of m[3].matchAll(/(?:^|[;{])\s*(--[a-z0-9-]+)\s*:/gim)) out[name].add(d[1]);
  }
  return out;
}

/**
 * Prose, dropped before the reference scan. A token name in backticks inside a
 * comment — `--text-disabled`, exactly as this sentence does it — otherwise
 * reads as a string reference and keeps a DEAD token looking alive. Block
 * comments only: a `//` rule would eat the rest of any line holding https://.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '\n');

/** Everything that is not a custom-property declaration. */
const stripDeclarations = (text) => text.replace(/--[a-z0-9-]+\s*:[^;}]*[;}]/gi, '\n');

const arg = process.argv[2];
let declared, themes, haystack, hues, colour, roles, pairs;

if (arg) {
  const html = readFileSync(arg, 'utf8');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  declared = declaredIn(css);
  themes = themeBlocks(css);
  hues = hueViolations(css);
  colour = colourTokens(css);
  haystack = stripComments(stripDeclarations(html));
  roles = roleViolations(css, haystack);
  pairs = pairViolations(themeValueBlocks(css));
} else {
  // The artifact-page runtime (src/artifact-runtime) is styled with the same
  // tokens through the generated sheet, so its CSS and components are held to
  // the same rules: every var() must resolve to index.css and no hex appears.
  // The agent guidance in artifact-tool-guidance.ts names tokens too; it is
  // read here so a token it points agents at cannot be one that does not exist.
  const files = [...walk('src/renderer'), ...walk('src/artifact-runtime'), AGENT_ARTIFACT_GUIDANCE];
  const declCss = files
    .filter((f) => DECL_FILES.includes(basename(f)))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  declared = declaredIn(declCss);
  themes = themeBlocks(declCss);
  hues = hueViolations(declCss);
  colour = colourTokens(declCss);
  // The declaration files are in the haystack too, with their DECLARATIONS
  // stripped out. Without that strip a token is "used" the moment it is
  // mirrored (`--color-x: var(--x)`) and nothing is ever dead; with the file
  // excluded outright, a token consumed only by a component rule in the same
  // file — `::selection` reaching for `--selection-bg` — is wrongly dead.
  // Stripping is what makes both questions answerable from one pass, and it
  // is how the single-file prototype has always been read.
  haystack = files
    .map((f) => {
      const text = readFileSync(f, 'utf8');
      return stripComments(DECL_FILES.includes(basename(f)) ? stripDeclarations(text) : text);
    })
    .join('\n');
  // Role misuse is a question about CALL SITES, so it reads every file, not
  // just the two that declare tokens.
  const allCss = files
    .filter((f) => extname(f) === '.css')
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
  roles = roleViolations(allCss, haystack);
  pairs = pairViolations(themeValueBlocks(declCss));
}

const referenced = referencedIn(haystack);

// Inside the sandbox a page sees ONLY the generated sheet, not index.css. A
// var() in the runtime (or in the guidance handed to agents) that index.css
// declares but the sheet does not emit resolves in the renderer and silently
// fails in every frame — so those files are held to the sheet's token set.
const PAGE_TOKEN_FILES = [...walk('src/artifact-runtime'), AGENT_ARTIFACT_GUIDANCE].filter(
  (f) => !basename(f).includes('.test.')
);
const pageSheetTokens = new Set(
  [
    ...generatePageTokenSheet(readFileSync('src/renderer/index.css', 'utf8')).matchAll(
      /(--[a-z0-9-]+)\s*:/g
    ),
  ].map((m) => m[1])
);
const pageReferenced = referencedIn(
  PAGE_TOKEN_FILES.map((f) => stripComments(readFileSync(f, 'utf8'))).join('\n')
);
const outsidePageSheet = [...pageReferenced].filter((t) =>
  t.endsWith('-*')
    ? ![...pageSheetTokens].some((p) => p.startsWith(t.slice(0, -1)))
    : !pageSheetTokens.has(t)
);
const families = [...referenced].filter((r) => r.endsWith('-*')).map((r) => r.slice(0, -1));
const directly = (t) =>
  referenced.has(t) || families.some((f) => t.startsWith(f)) || utilityFor(haystack, t);

const mirrorOf = (t) => `--color${t.slice(1)}`;
/**
 * A token is live if it is reached for directly, OR through its `@theme`
 * mirror (`bg-action-bg-hover` resolves `--color-action-bg-hover`, which
 * resolves `--action-bg-hover`), OR — for a `--x--line-height` companion —
 * because its `--x` font-size is: one Tailwind utility emits both, so the
 * companion is never written on its own.
 */
const isReferenced = (t) =>
  directly(t) ||
  (declared.has(mirrorOf(t)) && directly(mirrorOf(t))) ||
  (t.endsWith('--line-height') && directly(t.replace(/--line-height$/, '')));

const unresolved = [...referenced]
  .filter((r) => !r.endsWith('-*') && !RUNTIME_INJECTED.has(r))
  .filter((r) => !declared.has(r) && !declared.has(`--color${r.slice(1)}`));

// Two different failures, reported apart because they need different fixes.
// A dead TOKEN is deleted. A dead MIRROR means the `@theme inline` entry that
// generates a Tailwind utility is unused — the underlying token is still live,
// consumed via cssVar(), so only the mirror goes.
const allUnused = [...declared].filter((t) => !isReferenced(t));
const unusedMirrors = allUnused.filter(
  (t) => t.startsWith('--color-') && directly(`--${t.slice('--color-'.length)}`)
);
const unusedAll = allUnused.filter((t) => !unusedMirrors.includes(t));
const unused = unusedAll.filter((t) => colour.has(t));
const unusedOutOfScope = unusedAll.filter((t) => !colour.has(t));

const names = Object.keys(themes);
let parity = [];
if (names.length === 2) {
  const [a, b] = names;
  parity = [
    ...[...themes[a]].filter((t) => !themes[b].has(t)).map((t) => `${a}-only ${t}`),
    ...[...themes[b]].filter((t) => !themes[a].has(t)).map((t) => `${b}-only ${t}`),
  ];
}

const report = (label, list) => {
  console.log(`${list.length === 0 ? 'PASS' : 'FAIL'}  ${label}: ${list.length}`);
  for (const x of list.sort()) console.log(`        ${x}`);
};

console.log(`declared ${declared.size}   referenced ${referenced.size}`);
if (names.length === 2)
  console.log(
    `themes   ${names[0]} ${themes[names[0]].size} / ${names[1]} ${themes[names[1]].size}`
  );
console.log('');
report('unresolved var()', unresolved);
report('declared but unused', unused);
report('unused @theme mirror (token is live, utility is not)', unusedMirrors);
report('hue outside --status-* / --diff-* / --identity-*', hues);
report('theme parity', parity);
report('fill token in a foreground property', roles);
report('palette contrast below floor', pairs);
report('page runtime var() outside the generated token sheet', outsidePageSheet);

if (unusedOutOfScope.length > 0) {
  console.log(`
note  ${unusedOutOfScope.length} unused NON-colour tokens (type scale, tracking,`);
  console.log('      spacing). Out of scope for this gate; listed so they are not forgotten.');
  for (const x of unusedOutOfScope.sort()) console.log(`        ${x}`);
}

process.exit(
  unresolved.length +
    unused.length +
    unusedMirrors.length +
    hues.length +
    parity.length +
    roles.length +
    pairs.length +
    outsidePageSheet.length ===
    0
    ? 0
    : 1
);
