import { describe, expect, it } from 'vitest';
import type { GitAiSettings } from '@shared/git-ai';
import type { LanePullRequest } from '@shared/lane-pull-requests';
import { prefillCreatePrForm } from './create-pr-form';

const SECONDARY: LanePullRequest = {
  worktreeId: 'lane-b',
  branchName: 'raghav/login--api',
  isPrimary: false,
  targetRef: 'origin/release/2.0',
  prBase: 'release/2.0',
  targetError: null,
  pr: null,
};

const DEFAULTS: GitAiSettings['prDefaults'] = {
  draft: false,
  useTemplate: true,
  openAfterCreate: false,
};

const TEMPLATE = {
  path: '.github/pull_request_template.md',
  text: '## Summary\n\n## Test plan\n',
};

describe('prefillCreatePrForm — the Create PR form opens on the focused lane', () => {
  it("shows the lane's branch as head and its target as base", () => {
    const form = prefillCreatePrForm({
      workItemName: 'Login',
      lane: SECONDARY,
      prDefaults: DEFAULTS,
      template: null,
    });
    expect(form.head).toBe('raghav/login--api');
    expect(form.base).toBe('release/2.0');
  });

  it('prefills the title with the work item name and, with no template, an empty body', () => {
    const form = prefillCreatePrForm({
      workItemName: 'Login',
      lane: SECONDARY,
      prDefaults: DEFAULTS,
      template: null,
    });
    expect(form).toMatchObject({ title: 'Login', body: '', draft: false, openAfterCreate: false });
  });

  it('shows no base for a lane whose target could not be resolved', () => {
    const lane: LanePullRequest = {
      ...SECONDARY,
      targetRef: null,
      prBase: null,
      targetError: 'no default branch',
    };
    expect(
      prefillCreatePrForm({ workItemName: 'Login', lane, prDefaults: DEFAULTS, template: null })
        .base
    ).toBeNull();
  });
});

/**
 * Settings › Git › AI › PR defaults prefill the form (plan §Phase 3 slice 4):
 * the draft checkbox, the repository's template in the body until Generate
 * replaces it, and whether the new PR opens in the browser.
 */
describe('prefillCreatePrForm — PR defaults', () => {
  it("puts the repository's template in the body when Use template is on", () => {
    expect(
      prefillCreatePrForm({
        workItemName: 'Login',
        lane: SECONDARY,
        prDefaults: DEFAULTS,
        template: TEMPLATE,
      }).body
    ).toBe('## Summary\n\n## Test plan\n');
  });

  it('leaves the body empty when Use template is off, even with a template', () => {
    expect(
      prefillCreatePrForm({
        workItemName: 'Login',
        lane: SECONDARY,
        prDefaults: { ...DEFAULTS, useTemplate: false },
        template: TEMPLATE,
      }).body
    ).toBe('');
  });

  it('ticks Create as draft and carries Open after create from the defaults', () => {
    const form = prefillCreatePrForm({
      workItemName: 'Login',
      lane: SECONDARY,
      prDefaults: { draft: true, useTemplate: true, openAfterCreate: true },
      template: null,
    });
    expect(form.draft).toBe(true);
    expect(form.openAfterCreate).toBe(true);
  });
});
