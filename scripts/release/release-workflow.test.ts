import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { PACKAGED_ENV_NAMES } from './lib/build-env.ts';

/**
 * .github/workflows/release.yml (devstation-pqub, C4): the shape GitHub runs, read from the
 * file. A release starts only from a green CI push run of this repository's main, is cut at
 * that run's commit, never drops or cancels a queued release, publishes only after the server
 * it needs is live, and keeps commit text, secrets and write access out of the jobs that do
 * not need them.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  env?: Record<string, string>;
  strategy?: { matrix?: { include?: Record<string, string>[] } };
  steps: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  concurrency: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
}

const workflow = parse(TEXT) as Workflow;
const jobs = workflow.jobs;
const needsOf = (job: Job) => (typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []));
const runs = (job: Job) => job.steps.map((step) => step.run ?? '').join('\n');
const HEAD_SHA = '${{ github.event.workflow_run.head_sha }}';

describe('release.yml trigger', () => {
  it('runs only when CI completes on main, and nothing else starts it', () => {
    expect(workflow.on).toEqual({
      workflow_run: { workflows: ['CI'], types: ['completed'], branches: ['main'] },
    });
  });

  it('preflight holds the run to a successful push run of this repository', () => {
    const condition = jobs.preflight.if ?? '';

    expect(condition).toContain("github.event.workflow_run.event == 'push'");
    expect(condition).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(condition).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(condition).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository'
    );
  });

  it('every job after preflight waits on it, so a non-release run stops there', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'preflight') continue;
      const upstream = new Set<string>();
      const walk = (j: Job) => needsOf(j).forEach((n) => (upstream.add(n), walk(jobs[n])));
      walk(job);
      expect(upstream, name).toContain('preflight');
    }
  });

  it('queues a release behind a running one, never cancelling or dropping it', () => {
    expect(workflow.concurrency).toEqual({
      group: 'release',
      'cancel-in-progress': false,
      queue: 'max',
    });
  });

  it('every checkout is the CI run head_sha, not main tip', () => {
    const checkouts = Object.values(jobs).flatMap((job) =>
      job.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))
    );

    expect(checkouts.length).toBeGreaterThanOrEqual(Object.keys(jobs).length - 1);
    for (const step of checkouts) expect(step.with?.ref).toBe(HEAD_SHA);
  });

  it('every job has a timeout', () => {
    for (const [name, job] of Object.entries(jobs)) {
      expect(job['timeout-minutes'], name).toBeGreaterThan(0);
    }
  });
});

describe('release.yml order (F10)', () => {
  it('publish needs every build and the server deploy, and runs only when the server is live or not needed', () => {
    expect(needsOf(jobs.publish)).toEqual(expect.arrayContaining(['build', 'server-deploy']));
    const condition = jobs.publish.if ?? '';
    expect(condition).toContain("needs.build.result == 'success'");
    expect(condition).toContain("needs.server-deploy.result == 'success'");
    expect(condition).not.toMatch(/\balways\(\)/);
  });

  it('the server deploys before publish, unless the range raises MIN_DESKTOP_VERSION', () => {
    expect(jobs['server-deploy'].if).toContain("needs.preflight.outputs.server == 'true'");
    expect(jobs['server-deploy'].if).toContain(
      "needs.preflight.outputs.min_desktop_raised != 'true'"
    );
  });

  it('a server that raises MIN_DESKTOP_VERSION deploys only after the probe and every channel meets it', () => {
    const late = jobs['server-deploy-late'];

    expect(needsOf(late)).toContain('probe');
    expect(late.if).toContain("needs.preflight.outputs.min_desktop_raised == 'true'");
    expect(late.if).toContain("needs.probe.result == 'success'");
    const script = runs(late);
    expect(script.indexOf('verify-min-desktop.ts')).toBeGreaterThan(-1);
    expect(script.indexOf('verify-min-desktop.ts')).toBeLessThan(
      script.indexOf('deploy-server.sh')
    );
  });

  it('the probe runs after publish', () => {
    expect(needsOf(jobs.probe)).toContain('publish');
    expect(runs(jobs.probe)).toContain('scripts/release/probe.ts');
  });

  it('within publish: the draft release, then R2 (manifests last), then the release goes public', () => {
    const script = runs(jobs.publish);
    const draft = script.indexOf('--draft --verify-tag');
    const r2 = script.indexOf('scripts/release/upload-r2.ts');
    const undraft = script.indexOf('--draft=false');

    expect(draft).toBeGreaterThan(-1);
    expect(r2).toBeGreaterThan(draft);
    expect(undraft).toBeGreaterThan(r2);
  });
});

describe('release.yml data and secrets', () => {
  it('no ${{ }} expression appears inside a run: script (event text reaches scripts as env only)', () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) {
        if (step.run) expect(step.run, `${name}: ${step.name ?? step.run}`).not.toContain('${{');
      }
    }
  });

  it('secrets appear only in the tag, server deploy and publish jobs', () => {
    const allowed = new Set(['tag', 'server-deploy', 'server-deploy-late', 'publish']);
    for (const [name, job] of Object.entries(jobs)) {
      if (allowed.has(name)) continue;
      expect(JSON.stringify(job), name).not.toMatch(/secrets\./);
    }
  });

  it('the workflow reads only; publish alone writes contents', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const [name, job] of Object.entries(jobs)) {
      const writes = Object.entries(job.permissions ?? {}).filter(([, v]) => v === 'write');
      expect(writes, name).toEqual(name === 'publish' ? [['contents', 'write']] : []);
    }
  });

  it('the tag is pushed with the release app token, the only actor the v* ruleset lets through', () => {
    const tag = jobs.tag;
    const mint = tag.steps.find((s) => s.uses?.startsWith('actions/create-github-app-token@'));

    expect(mint?.with).toMatchObject({
      'app-id': '${{ secrets.RELEASE_APP_ID }}',
      'private-key': '${{ secrets.RELEASE_APP_KEY }}',
    });
    expect(runs(tag)).toMatch(/git push origin "refs\/tags\/\$TAG"/);
  });
});

describe('release.yml checks', () => {
  it('preflight fetches every tag and lints migrations since the previous release', () => {
    const checkout = jobs.preflight.steps.find((s) => s.uses?.startsWith('actions/checkout@'));

    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(runs(jobs.preflight)).toMatch(
      /node --experimental-strip-types scripts\/release\/migration-lint\.ts --since "\$PREVIOUS"/
    );
    expect(runs(jobs.preflight)).toContain('scripts/release/release-preflight.ts');
  });

  it('the build writes the notes, builds with them, and checks the release dir before upload', () => {
    const script = runs(jobs.build);
    const notes = 'release-notes/$TAG.md';

    expect(script).toContain(`scripts/release/changelog.ts --extract "$TAG" --out "${notes}"`);
    expect(script).toContain(`--release-notes "${notes}"`);
    expect(script.indexOf('verify-release-dir.ts')).toBeGreaterThan(script.indexOf('build.ts'));
    expect(runs(jobs.publish)).toContain(`--notes-file "${notes}"`);
  });

  it("uploads the update manifests but not electron-builder's debug file, which publish would make public", () => {
    const upload = jobs.build.steps.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@')
    );
    const patterns = String(upload?.with?.path ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    // upload-artifact's globs as these patterns use them: * within one folder, ! excludes.
    const matches = (glob: string, file: string) =>
      new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(
        file
      );
    const uploaded = (file: string) =>
      patterns.some((p) => !p.startsWith('!') && matches(p, file)) &&
      !patterns.some((p) => p.startsWith('!') && matches(p.slice(1), file));

    expect(uploaded('release/builder-debug.yml')).toBe(false);
    for (const manifest of ['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'canary.yml']) {
      expect(uploaded(`release/${manifest}`), manifest).toBe(true);
    }
  });

  it('the build bakes every packaged-app variable, so the app it ships can sign in', () => {
    const env = jobs.build.env ?? {};

    expect(env.CHORD_RELEASE_BUILD).toBe('1');
    for (const name of PACKAGED_ENV_NAMES) expect(env[name], name).toMatch(/\S/);
  });

  it('builds mac arm64, linux x64 and win x64 on named runner images', () => {
    const matrix = jobs.build.strategy?.matrix?.include ?? [];

    expect(matrix.map((m) => `${m.platform}/${m.arch}/${m.runner}`).sort()).toEqual([
      'linux/x64/ubuntu-24.04',
      'mac/arm64/macos-15',
      'win/x64/windows-2025',
    ]);
  });
});
