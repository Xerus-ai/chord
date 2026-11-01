import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The leak guard's public rules (devstation-y74s.1): what must never land in this public repo.
 * Every fixture value is assembled from parts, so this file itself holds none of them.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCAN = join(HERE, 'scan.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

const at = (local: string, domain: string) => [local, domain].join('@');
const REAL_CONN = ['postgres', '://app:', 'Sup3r', 'S3cret', '@db.example.com/chord'].join('');
const PLACEHOLDER_CONN = ['postgres', '://app:', 'password', '@localhost/chord'].join('');
const PERSONAL_EMAIL = at('maya.chen', 'gmail.com');
const INTERNAL_HOST = ['build', 'internal'].join('.');
const PRIVATE_IP = ['10', '0', '0', '12'].join('.');

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository whose commits each write `files`; the author is `email`. */
function createRepo(commits: { files: Record<string, string>; message?: string }[], email: string) {
  const repo = mkdtempSync(join(tmpdir(), 'leak-guard-'));
  temps.push(repo);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Leak Guard Test');
  git('config', 'user.email', email);
  for (const [i, commit] of commits.entries()) {
    for (const [name, body] of Object.entries(commit.files)) {
      mkdirSync(dirname(join(repo, name)), { recursive: true });
      writeFileSync(join(repo, name), body);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', commit.message ?? `chore: commit ${i} (lg-${i})`);
  }
  return { repo, git };
}

function scan(args: string[], repo: string) {
  const r = spawnSync(PYTHON, [SCAN, ...args, '--repo', repo], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('scan.py tree', () => {
  it('flags each rule by name and place, never printing the value', () => {
    const { repo } = createRepo(
      [
        {
          files: {
            'a.ts': `const url = '${REAL_CONN}';\n`,
            'b.md': `Write to ${PERSONAL_EMAIL}.\n`,
            'c.yml': `host: ${INTERNAL_HOST}\n`,
            'd.ts': `const ip = '${PRIVATE_IP}';\n`,
            'data/dump.sqlite': 'rows',
          },
        },
      ],
      at('ci', 'example.com')
    );

    const r = scan(['tree'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('connection-string a.ts:1');
    expect(r.out).toContain('email b.md:1');
    expect(r.out).toContain('internal-host c.yml:1');
    expect(r.out).toContain('internal-host d.ts:1');
    expect(r.out).toContain('data-file data/dump.sqlite');
    for (const value of ['Sup3rS3cret', PERSONAL_EMAIL, INTERNAL_HOST, PRIVATE_IP]) {
      expect(r.out).not.toContain(value);
    }
  });

  it('passes placeholders, reserved domains, allowed hosts and fixture data files', () => {
    const { repo } = createRepo(
      [
        {
          files: {
            'a.ts': `const url = '${PLACEHOLDER_CONN}';\n`,
            // Placeholder shapes: <...>, ${...}, {...}, stars and x's are not passwords.
            'shapes.ts': ['<password>', '${DB_PASSWORD}', '{password}', '****', 'xxxx']
              .map(
                (pw) =>
                  `const url = '${['postgres', '://app:', pw, '@localhost/chord'].join('')}';\n`
              )
              .join(''),
            'b.md': `Write to ${at('maya', 'example.com')} or ${at('someone', 'gmail.com')}.\n`,
            'c.yml': `host: ${['build', 'acme', 'corp'].join('.')}\n`,
            'src/_testing/fixture.db': 'rows',
          },
        },
      ],
      at('ci', 'example.com')
    );

    const r = scan(['tree'], repo);

    expect(r.out).toBe('');
    expect(r.code).toBe(0);
  });

  it("flags the repository's own committers' addresses, read from git log", () => {
    const committer = at('maya', 'studio.io');
    const { repo, git } = createRepo([{ files: { 'a.md': `Ask ${committer}.\n` } }], committer);
    // A CI checkout has no user.email: the address must come from the log, not the config.
    git('config', 'user.email', at('ci', 'example.com'));

    const r = scan(['tree'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('email a.md:1');
  });

  it('does not count a noreply or reserved-TLD committer as a real address', () => {
    for (const committer of [at('ci-noreply', 'studio.io'), at('maya', 'studio.test')]) {
      const { repo } = createRepo([{ files: { 'a.md': `Ask ${committer}.\n` } }], committer);

      const r = scan(['tree'], repo);

      expect(r.out).toBe('');
      expect(r.code).toBe(0);
    }
  });

  it('exempts an allowlisted file exactly and a folder by prefix, nothing near them', () => {
    const host = `host: ${INTERNAL_HOST}\n`;
    const { repo } = createRepo(
      [{ files: { NOTICE: host, 'LICENSES/font.txt': host, 'NOTICES.md': host } }],
      at('ci', 'example.com')
    );

    const r = scan(['tree'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('internal-host NOTICES.md:1');
    expect(r.out).not.toContain('internal-host NOTICE:');
    expect(r.out).not.toContain('LICENSES/font.txt');
  });
});

describe('scan.py range', () => {
  it("scans only the range's added lines and commit messages", () => {
    const { repo, git } = createRepo(
      [
        { files: { 'old.md': `Old: ${PERSONAL_EMAIL}\n` } },
        { files: { 'new.md': 'clean\n' }, message: `chore: ping ${PERSONAL_EMAIL} (lg-1)` },
        { files: { 'later.yml': `host: ${INTERNAL_HOST}\n` } },
      ],
      at('ci', 'example.com')
    );
    const base = git('rev-parse', 'HEAD~2');

    const r = scan(['range', base, 'HEAD'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('internal-host later.yml:1');
    expect(r.out).toMatch(/email message [0-9a-f]{12}/);
    expect(r.out).not.toContain('old.md');
  });

  it('a base of forty zeros (a push that made the branch) scans every commit HEAD reaches', () => {
    const { repo } = createRepo(
      [
        { files: { 'first.md': `Old: ${PERSONAL_EMAIL}\n` } },
        { files: { 'second.md': 'clean\n' } },
      ],
      at('ci', 'example.com')
    );

    const r = scan(['range', '0'.repeat(40), 'HEAD'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('email first.md:1');
  });

  it("reads an added line starting '++ ' as content, and names a quoted (non-ASCII) path", () => {
    const { repo, git } = createRepo(
      [
        { files: { 'seed.md': 'seed\n' } },
        {
          files: {
            'counter.txt': `++ counter\nhost: ${INTERNAL_HOST}\n`,
            'naïve.md': `host: ${INTERNAL_HOST}\n`,
          },
        },
      ],
      at('ci', 'example.com')
    );

    const r = scan(['range', git('rev-parse', 'HEAD~1'), 'HEAD'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('internal-host counter.txt:2');
    expect(r.out).toContain('internal-host naïve.md:1');
  });

  it('flags a file renamed to a data-file extension', () => {
    const { repo, git } = createRepo(
      [{ files: { 'notes.txt': 'rows\n' } }],
      at('ci', 'example.com')
    );
    git('mv', 'notes.txt', 'dump.sqlite');
    git('commit', '-q', '-m', 'chore: rename (lg-1)');

    const r = scan(['range', git('rev-parse', 'HEAD~1'), 'HEAD'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('data-file dump.sqlite');
  });

  it('scans the content of a file renamed out of an allowlisted folder', () => {
    const { repo, git } = createRepo(
      [{ files: { 'LICENSES/font.txt': `host: ${INTERNAL_HOST}\n` } }],
      at('ci', 'example.com')
    );
    git('mv', 'LICENSES/font.txt', 'font.txt');
    git('commit', '-q', '-m', 'chore: move (lg-1)');

    const r = scan(['range', git('rev-parse', 'HEAD~1'), 'HEAD'], repo);

    expect(r.code).toBe(1);
    expect(r.out).toContain('internal-host font.txt:1');
  });
});

describe('public_rules.committer_emails', () => {
  it('fails, not an empty set, when git cannot read the log', () => {
    const notRepo = mkdtempSync(join(tmpdir(), 'leak-guard-norepo-'));
    temps.push(notRepo);
    const probe = [
      'import sys',
      'sys.dont_write_bytecode = True',
      'sys.path.insert(0, sys.argv[1])',
      'import public_rules as p',
      'print(sorted(p.committer_emails([sys.argv[2]], p.load_config())))',
    ].join('\n');

    const r = spawnSync(PYTHON, ['-c', probe, HERE, notRepo], { encoding: 'utf8' });

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/git log .* failed/);
  });
});

describe("the app's tree", () => {
  it('passes the leak guard', () => {
    const r = scan(['tree'], ROOT);

    expect(r.out).toBe('');
    expect(r.code).toBe(0);
  });
});
