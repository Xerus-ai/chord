/**
 * Prism's language aliases (`ts` for typescript, `py` for python, …), as
 * refractor's grammars declare them (`<grammar>.aliases` in refractor/lang;
 * prism-language.test.ts checks the table against those files).
 *
 * Code blocks load their grammar on first use (PrismAsyncLight), and its
 * loaders are keyed by grammar name only, so an alias found no loader and
 * its block rendered plain. The full Prism build resolved them itself.
 */
export const PRISM_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  g4: 'antlr4',
  ino: 'arduino',
  adoc: 'asciidoc',
  avs: 'avisynth',
  shell: 'bash',
  shortcode: 'bbcode',
  rbnf: 'bnf',
  coffee: 'coffeescript',
  conc: 'concurnas',
  dotnet: 'csharp',
  cs: 'csharp',
  razor: 'cshtml',
  jinja2: 'django',
  dockerfile: 'docker',
  gv: 'dot',
  eta: 'ejs',
  gni: 'gn',
  hbs: 'handlebars',
  hs: 'haskell',
  idr: 'idris',
  gitignore: 'ignore',
  hgignore: 'ignore',
  npmignore: 'ignore',
  js: 'javascript',
  webmanifest: 'json',
  kt: 'kotlin',
  kts: 'kotlin',
  kum: 'kumir',
  tex: 'latex',
  context: 'latex',
  md: 'markdown',
  html: 'markup',
  mathml: 'markup',
  svg: 'markup',
  xml: 'markup',
  ssml: 'markup',
  atom: 'markup',
  rss: 'markup',
  moon: 'moonscript',
  n4jsd: 'n4js',
  objc: 'objectivec',
  qasm: 'openqasm',
  objectpascal: 'pascal',
  px: 'pcaxis',
  pcode: 'peoplecode',
  purs: 'purescript',
  py: 'python',
  qs: 'qsharp',
  rkt: 'racket',
  rpy: 'renpy',
  rb: 'ruby',
  smlnj: 'sml',
  sol: 'solidity',
  rq: 'sparql',
  ts: 'typescript',
  tsconfig: 'typoscript',
  uc: 'unrealscript',
  uscript: 'unrealscript',
  url: 'uri',
  mathematica: 'wolfram',
  wl: 'wolfram',
  nb: 'wolfram',
  xeoracube: 'xeora',
  yml: 'yaml',
};

/** The grammar a code fence's language names: an alias resolved, a name as is. */
export function resolvePrismLanguage(language: string): string {
  const lower = language.toLowerCase();
  return PRISM_LANGUAGE_ALIASES[lower] ?? lower;
}
