import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REPO_ICON_IMAGE_BYTES } from '@shared/repo-icons';
import { detectRepoIcon } from '../detect-repo-icon';
import { detectRepoIconFile } from '../detect-repo-icon-file';
import { createRepoFactory, PNG_A, PNG_B, summarizeOutcome } from './repo-icon-detection-cases';

type CreateRepo = ReturnType<typeof createRepoFactory>['createRepo'];

/**
 * Origin-remote shapes for the repo-icon detection characterization
 * (devstation-7orh), against a loopback avatar server that records every path
 * it is asked for. The expected record was taken from the implementation
 * before its rewrite and must not change.
 */
const REMOTE_SHAPES: Array<[string, string[][]]> = [
  ['https', [['remote', 'add', 'origin', 'https://github.com/owner/thing.git']]],
  ['https without .git', [['remote', 'add', 'origin', 'https://github.com/owner/thing']]],
  ['https trailing slash', [['remote', 'add', 'origin', 'https://github.com/owner/thing/']]],
  ['http', [['remote', 'add', 'origin', 'http://github.com/owner/thing.git']]],
  ['scp', [['remote', 'add', 'origin', 'git@github.com:owner/thing.git']]],
  ['ssh url', [['remote', 'add', 'origin', 'ssh://git@github.com/owner/thing.git']]],
  ['git protocol', [['remote', 'add', 'origin', 'git://github.com/owner/thing.git']]],
  ['upper-case host', [['remote', 'add', 'origin', 'https://GitHub.com/owner/thing.git']]],
  ['www host', [['remote', 'add', 'origin', 'https://www.github.com/owner/thing.git']]],
  ['enterprise host', [['remote', 'add', 'origin', 'https://github.acme.corp/owner/thing.git']]],
  [
    'lookalike host',
    [['remote', 'add', 'origin', 'https://github.com.evil.example/owner/thing.git']],
  ],
  ['user in url', [['remote', 'add', 'origin', 'https://user@github.com/owner/thing.git']]],
  [
    'token in url',
    [['remote', 'add', 'origin', 'https://x-access-token:abc@github.com/owner/thing.git']],
  ],
  ['nested slug', [['remote', 'add', 'origin', 'https://github.com/owner/group/thing.git']]],
  ['owner only', [['remote', 'add', 'origin', 'https://github.com/owner']]],
  ['owner with underscore', [['remote', 'add', 'origin', 'https://github.com/own_er/thing.git']]],
  ['avatar 500', [['remote', 'add', 'origin', 'https://github.com/err/thing.git']]],
  ['avatar 200 html', [['remote', 'add', 'origin', 'https://github.com/html/thing.git']]],
  ['avatar oversized', [['remote', 'add', 'origin', 'https://github.com/big/thing.git']]],
  ['avatar redirect', [['remote', 'add', 'origin', 'https://github.com/redirect/thing.git']]],
  ['avatar 418', [['remote', 'add', 'origin', 'https://github.com/teapot/thing.git']]],
  ['avatar 404', [['remote', 'add', 'origin', 'https://github.com/missing/thing.git']]],
  ['local path remote', [['remote', 'add', 'origin', '../elsewhere']]],
  ['gitlab', [['remote', 'add', 'origin', 'https://gitlab.com/gitlab-org/gitlab.git']]],
  ['upstream only', [['remote', 'add', 'upstream', 'https://github.com/owner/thing.git']]],
  [
    'origin gitlab, upstream github',
    [
      ['remote', 'add', 'origin', 'https://gitlab.com/x/thing.git'],
      ['remote', 'add', 'upstream', 'https://github.com/owner/thing.git'],
    ],
  ],
  [
    'push url differs',
    [
      ['remote', 'add', 'origin', 'https://gitlab.com/x/y.git'],
      ['remote', 'set-url', '--push', 'origin', 'https://github.com/owner/thing.git'],
    ],
  ],
  ['no remotes', []],
];

export async function collectRemoteRecord(createRepo: CreateRepo) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/owner.png') return void response.writeHead(200).end(PNG_B);
    if (path === '/err.png') return void response.writeHead(500).end('x');
    if (path === '/html.png') return void response.writeHead(200).end('<html></html>');
    if (path === '/big.png') {
      return void response
        .writeHead(200)
        .end(Buffer.concat([PNG_B, Buffer.alloc(MAX_REPO_ICON_IMAGE_BYTES)]));
    }
    if (path === '/redirect.png') {
      return void response.writeHead(302, { location: '/owner.png' }).end();
    }
    if (path === '/teapot.png') return void response.writeHead(418).end();
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const avatarOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const detect = async (repoPath: string) => {
      requests.length = 0;
      const outcome = await detectRepoIcon({ repoPath, avatarOrigin, timeoutMs: 5_000 });
      return `${summarizeOutcome(outcome)}; asked ${JSON.stringify(requests)}`;
    };
    const record: Record<string, string> = {};
    for (const [name, git] of REMOTE_SHAPES) {
      record[name] = await detect(await createRepo({}, git));
    }
    const github = [['remote', 'add', 'origin', 'https://github.com/owner/thing.git']];
    record['not a git repository'] = await detect(await createRepo({}));
    record['icon file and github remote'] = await detect(
      await createRepo({ 'favicon.png': PNG_A }, github)
    );
    record['unusable icon file and github remote'] = await detect(
      await createRepo({ 'favicon.png': '<html>' }, github)
    );

    const missing = join(tmpdir(), 'chord-icon-char-missing-dir');
    const missingOutcome = await detectRepoIcon({ repoPath: missing, avatarOrigin });
    const fileProbeMissing = await detectRepoIconFile(missing);
    const notDirectory = join(await createRepo({ 'x.txt': 'x' }), 'x.txt');
    const notDirectoryOutcome = await detectRepoIconFile(notDirectory);
    const failing = await createRepo({}, [
      ['remote', 'add', 'origin', 'https://github.com/err/thing.git'],
    ]);
    const failingOutcome = await detectRepoIcon({ repoPath: failing, avatarOrigin });
    const errorOf = (outcome: Awaited<ReturnType<typeof detectRepoIcon>>, path: string) =>
      outcome.kind === 'failed'
        ? outcome.error.split(path).join('<path>').split(avatarOrigin).join('<origin>')
        : outcome.kind;
    record['missing directory'] = errorOf(missingOutcome, missing);
    record['file probe, missing directory'] = errorOf(fileProbeMissing, missing);
    record['file probe, a file not a directory'] = errorOf(notDirectoryOutcome, notDirectory);
    record['avatar 500 error'] = errorOf(failingOutcome, failing);
    return record;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
