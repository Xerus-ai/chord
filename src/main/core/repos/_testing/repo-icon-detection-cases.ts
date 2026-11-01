import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { RepoIconDetectionOutcome } from '@shared/repo-icon-detection';
import { MAX_REPO_ICON_IMAGE_BYTES } from '@shared/repo-icons';
import { detectRepoIconFile, REPO_ICON_FILE_CANDIDATES } from '../detect-repo-icon-file';

/**
 * Repository shapes for the repo-icon detection characterization
 * (devstation-7orh). Each shape is a real temp directory; the record names what
 * detection returned for it. The expected record was taken from the
 * implementation before its rewrite and must not change.
 */
const runGit = promisify(execFile);

export const PNG_A = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);
export const PNG_B = Buffer.concat([PNG_A, Buffer.from([0x00, 0x01])]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
  Buffer.alloc(14),
]);
const ICO = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00', 'binary');

function nameImage(src: string): string {
  if (src.endsWith(PNG_A.toString('base64'))) return 'PNG_A';
  if (src.endsWith(PNG_B.toString('base64'))) return 'PNG_B';
  if (src.startsWith('data:image/jpeg')) return 'JPEG';
  if (src.startsWith('data:image/webp')) return 'WEBP';
  return `other ${src.slice(0, 30)}`;
}

export function summarizeOutcome(outcome: RepoIconDetectionOutcome): string {
  if (outcome.kind === 'none') return 'none';
  if (outcome.kind === 'failed') return 'failed';
  if (outcome.icon.type !== 'image') return `found ${JSON.stringify(outcome.icon)}`;
  return `found ${nameImage(outcome.icon.src)} from ${outcome.icon.source}`;
}

/** Temp repositories, removed by `removeRepos`. A `null` body is a directory. */
export function createRepoFactory() {
  const dirs: string[] = [];
  const createRepo = async (
    files: Record<string, Buffer | string | null>,
    gitCommands?: string[][]
  ): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'chord-icon-char-'));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
      const target = join(dir, name);
      if (body === null) {
        await mkdir(target, { recursive: true });
        continue;
      }
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, body);
    }
    if (gitCommands) {
      await runGit('git', ['init', '-q'], { cwd: dir });
      for (const args of gitCommands) await runGit('git', args, { cwd: dir });
    }
    return dir;
  };
  const removeRepos = async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
  return { createRepo, removeRepos };
}

type CreateRepo = ReturnType<typeof createRepoFactory>['createRepo'];

const LAST_CANDIDATE = REPO_ICON_FILE_CANDIDATES[REPO_ICON_FILE_CANDIDATES.length - 1];

/** Which files may declare an icon href, and where a declared href may land. */
export async function collectDeclaringFileRecord(createRepo: CreateRepo) {
  const declaring = [
    'index.html',
    'public/index.html',
    'src/index.html',
    'app/index.html',
    'docs/index.html',
    'apps/web/index.html',
    'src/routes/__root.tsx',
    'app/routes/__root.tsx',
    'src/app/routes/__root.tsx',
    'src/routes/__root.jsx',
    'src/routes/__root.ts',
    'app/root.tsx',
    'src/root.tsx',
    'app/layout.tsx',
    'src/app/layout.tsx',
    'pages/_document.tsx',
    'nuxt.config.ts',
    'src/layouts/Layout.astro',
    'index.htm',
    'src/main.tsx',
    'src/App.vue',
    'src/app.html',
    'public/manifest.json',
  ];
  const record: Record<string, string> = {};
  for (const file of declaring) {
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const body = /\.(tsx|ts|jsx)$/.test(file)
      ? "const links = [{ rel: 'icon', href: '/zz-mark.png' }]"
      : '<link rel="icon" href="/zz-mark.png">';
    const targets = ['public/zz-mark.png', 'zz-mark.png'];
    if (dir) targets.push(`${dir}/zz-mark.png`);
    const results: string[] = [];
    for (const target of targets) {
      const repo = await createRepo({ [file]: body, [target]: PNG_A });
      results.push(`${target}: ${summarizeOutcome(await detectRepoIconFile(repo))}`);
    }
    record[file] = results.join(' | ');
  }
  return record;
}

/** Each ordered pair of declaring files: the earlier declares PNG_A, the later PNG_B. */
export async function collectDeclaringOrderRecord(createRepo: CreateRepo) {
  const declaring = [
    'index.html',
    'public/index.html',
    'src/index.html',
    'src/routes/__root.tsx',
    'app/routes/__root.tsx',
    'app/root.tsx',
    'src/root.tsx',
  ];
  const body = (file: string, target: string) =>
    file.endsWith('.html')
      ? `<link rel="icon" href="/${target}">`
      : `const links = [{ rel: 'icon', href: '/${target}' }]`;
  const record: Record<string, string> = {};
  for (const first of declaring) {
    for (const second of declaring) {
      if (first === second) continue;
      const repo = await createRepo({
        [first]: body(first, 'first.png'),
        'public/first.png': PNG_A,
        [second]: body(second, 'second.png'),
        'public/second.png': PNG_B,
      });
      record[`${first} vs ${second}`] = summarizeOutcome(await detectRepoIconFile(repo));
    }
  }
  return record;
}

/** Href resolution, formats, every candidate, precedence and size limits. */
export async function collectFileProbeRecord(createRepo: CreateRepo) {
  const probe = async (files: Record<string, Buffer | string | null>) =>
    summarizeOutcome(await detectRepoIconFile(await createRepo(files)));

  const resolution: Record<string, string> = {};
  for (const [href, target] of [
    ['mark.png', 'src/routes/mark.png'],
    ['mark.png', 'public/mark.png'],
    ['mark.png', 'mark.png'],
    ['./mark.png', 'src/routes/mark.png'],
    ['../mark.png', 'src/mark.png'],
    ['/mark.png', 'src/routes/mark.png'],
    ['/mark.png', 'mark.png'],
    ['/mark.png', 'public/mark.png'],
    ['/img/mark.png', 'public/img/mark.png'],
    ['/img/mark.png', 'img/mark.png'],
  ]) {
    resolution[`__root.tsx ${href} -> ${target}`] = await probe({
      'src/routes/__root.tsx': `const links = [{ rel: 'icon', href: '${href}' }]`,
      [target]: PNG_A,
    });
  }
  for (const [href, target] of [
    ['/static/a.png', 'public/static/a.png'],
    ['/a.png?v=2', 'public/a.png'],
    ['/a.png#x', 'public/a.png'],
    ['%PUBLIC_URL%/a.png', 'public/a.png'],
    ['/a%20b.png', 'public/a b.png'],
    ['/a%20b.png', 'public/a%20b.png'],
  ]) {
    resolution[`index.html ${href} -> ${target}`] = await probe({
      'index.html': `<link rel="icon" href="${href}">`,
      [target]: PNG_A,
    });
  }
  resolution['public/ copy before root copy'] = await probe({
    'index.html': '<link rel="icon" href="/b.png">',
    'public/b.png': PNG_A,
    'b.png': PNG_B,
  });
  resolution['declaring folder before public/'] = await probe({
    'src/routes/__root.tsx': "{ rel: 'icon', href: 'b.png' }",
    'src/routes/b.png': PNG_A,
    'public/b.png': PNG_B,
  });

  const formats: Record<string, string> = {};
  for (const [name, bytes] of Object.entries({ PNG_A, JPEG, WEBP, ICO, SVG, GIF })) {
    formats[`favicon.png holds ${name}`] = await probe({ 'favicon.png': bytes });
    for (const ext of ['jpg', 'ico', 'svg', 'png']) {
      formats[`declared x.${ext} holds ${name}`] = await probe({
        'index.html': `<link rel="icon" href="/x.${ext}">`,
        [`public/x.${ext}`]: bytes,
      });
    }
  }
  for (const name of ['favicon.jpg', 'favicon.ico', 'favicon.svg', 'icon.jpeg', 'logo.gif']) {
    formats[`${name} holds PNG_A`] = await probe({ [name]: PNG_A });
  }
  formats['favicon.png empty'] = await probe({ 'favicon.png': '' });

  const candidates: Record<string, string> = {};
  for (const candidate of REPO_ICON_FILE_CANDIDATES) {
    candidates[candidate] = await probe({ [candidate]: PNG_A });
  }

  const brand = { 'index.html': '<link rel="icon" href="/brand.png">', 'public/brand.png': PNG_B };
  const precedence: Record<string, string> = {
    'first candidate and a declared href': await probe({ 'favicon.png': PNG_A, ...brand }),
    'last candidate and a declared href': await probe({ [LAST_CANDIDATE]: PNG_A, ...brand }),
    'declared target missing, later candidate': await probe({
      'index.html': '<link rel="icon" href="/nothing.png">',
      [LAST_CANDIDATE]: PNG_A,
    }),
    'earlier declaring file target missing': await probe({
      'index.html': '<link rel="icon" href="/nope.png">',
      'src/root.tsx': "{ rel: 'icon', href: '/b.png' }",
      'public/b.png': PNG_B,
    }),
    'earlier declaring file without a link': await probe({
      'index.html': '<html></html>',
      'src/root.tsx': "{ rel: 'icon', href: '/b.png' }",
      'public/b.png': PNG_B,
    }),
    'earlier declaring file target not an image': await probe({
      'index.html': '<link rel="icon" href="/bad.png">',
      'public/bad.png': '<html>',
      'src/root.tsx': "{ rel: 'icon', href: '/b.png' }",
      'public/b.png': PNG_B,
    }),
    'declared target is a directory': await probe({
      'index.html': '<link rel="icon" href="/dir.png">',
      'public/dir.png': null,
    }),
    'index.html is a directory': await probe({ 'index.html': null }),
    'declared target oversized': await probe({
      'index.html': '<link rel="icon" href="/big.png">',
      'public/big.png': Buffer.concat([PNG_A, Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES)]),
    }),
    'declared target oversized, root copy usable': await probe({
      'index.html': '<link rel="icon" href="/big.png">',
      'public/big.png': Buffer.concat([PNG_A, Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES)]),
      'big.png': PNG_B,
    }),
    'empty directory': await probe({}),
  };

  const link = '<link rel="icon" href="/a.png">';
  const sizes: Record<string, string> = {};
  for (const total of [
    MAX_REPO_ICON_IMAGE_BYTES - 1,
    MAX_REPO_ICON_IMAGE_BYTES,
    MAX_REPO_ICON_IMAGE_BYTES + 1,
  ]) {
    sizes[`index.html of ${total} bytes, link first`] = await probe({
      'index.html': `${link}${' '.repeat(total - link.length)}`,
      'public/a.png': PNG_A,
    });
    sizes[`index.html of ${total} bytes, link last`] = await probe({
      'index.html': `${' '.repeat(total - link.length)}${link}`,
      'public/a.png': PNG_A,
    });
  }

  return {
    candidateList: REPO_ICON_FILE_CANDIDATES,
    resolution,
    formats,
    candidates,
    precedence,
    sizes,
  };
}
