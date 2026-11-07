/**
 * UI steps and the report for `pr-per-lane.mjs`: focusing a lane the way a
 * user does, finding the band's Create PR wherever the ladder put it, and
 * reading what the Create PR form says it will do.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { waitFor } from './sharing/sharing-accounts.mjs';

/** Numbered screenshots under <e2e out>/screenshots and PASS/FAIL verdicts. */
export function createReport(prefix) {
  const shots = E2E_SHOTS_DIR;
  mkdirSync(shots, { recursive: true });
  let count = 0;
  const results = [];
  return {
    results,
    shot: (name) => join(shots, `${prefix}-${String(++count).padStart(2, '0')}-${name}.png`),
    verdict(name, ok, detail) {
      results.push({ name, ok, detail });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
    },
  };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Focuses a lane the way the user does: Changes › branch menu › the lane's branch. */
export async function focusLane(page, branch) {
  // The rail's panels are tabs (role=tab), named with their count: "Changes 2".
  await page
    .getByRole('tab', { name: /^Changes/ })
    .first()
    .click();
  const scope = page.getByTitle('Show another worktree’s changes');
  await scope.click();
  const item = page.getByRole('menuitem', { name: branch, exact: true });
  await item.waitFor({ timeout: 15_000 });
  if ((await item.getAttribute('aria-disabled')) === 'true') {
    await page.keyboard.press('Escape');
  } else {
    await item.click();
  }
  // The scope menu's label is the focused lane's branch — exactly: the
  // primary's branch is a prefix of every secondary's (`<branch>--api`).
  const exact = new RegExp(`^\\s*${escapeRegExp(branch)}\\s*$`);
  await scope.filter({ hasText: exact }).waitFor({ timeout: 15_000 });
}

/** The band's Create PR, wherever the ladder put it: the button, or under the caret. */
async function findCreatePr(page) {
  const button = page.getByRole('button', { name: 'Create PR', exact: true });
  if (await button.isVisible()) return { control: button, inMenu: false };
  await page.getByRole('button', { name: 'Other actions' }).click();
  // A disabled item's name includes its reason line ("Create PR This
  // repository has no GitHub remote"), so match the label at the start.
  const item = page.getByRole('menuitem', { name: /^Create PR(\s|$)/ });
  await item.waitFor({ timeout: 10_000 });
  return { control: item, inMenu: true };
}

async function isDisabledControl(control) {
  return (
    (await control.getAttribute('aria-disabled')) === 'true' ||
    (await control.getAttribute('data-disabled')) !== null
  );
}

/** Opens Create PR for the focused lane and reads what the form says it will do. */
export async function openCreatePrForm(page) {
  await waitFor(
    async () => {
      const { control, inMenu } = await findCreatePr(page);
      const enabled = !(await isDisabledControl(control));
      if (enabled) await control.click();
      else if (inMenu) await page.keyboard.press('Escape');
      return enabled;
    },
    60_000,
    'Create PR to be offered for the focused lane'
  );
  const dialog = page.getByRole('dialog', { name: 'Create pull request' });
  await dialog.waitFor({ timeout: 15_000 });
  return {
    dialog,
    head: (await dialog.getByLabel('Head branch').innerText()).trim(),
    base: (await dialog.getByLabel('Base branch').innerText()).trim(),
    title: await dialog.getByRole('textbox', { name: 'Title' }).inputValue(),
    body: await dialog.getByRole('textbox', { name: 'Description' }).inputValue(),
  };
}

/** devstation-vzg: with no GitHub remote, Create PR sits disabled in the menu with its reason. */
export async function checkNoRemoteRefusal(page, report, primaryBranch) {
  await focusLane(page, primaryBranch);
  const { control, inMenu } = await findCreatePr(page);
  const disabled = await isDisabledControl(control);
  const reason = (await control.getAttribute('title')) ?? '';
  await page.screenshot({ path: report.shot('no-remote-refusal') });
  if (inMenu) await page.keyboard.press('Escape');
  report.verdict(
    'vzg: no GitHub remote → Create PR refused with the reason',
    inMenu && disabled && /GitHub remote/i.test(reason),
    `in menu: ${inMenu}, disabled: ${disabled}, title: "${reason}"`
  );
}

/** Focuses the lane, opens Create PR, and checks head, base and the prefilled fields. */
export async function checkFormFollowsLane(
  page,
  report,
  { label, branch, expectedBase, itemName }
) {
  await focusLane(page, branch);
  const form = await openCreatePrForm(page);
  await page.screenshot({ path: report.shot(`form-${label}`) });
  report.verdict(
    `${label} lane: form head is the lane's branch`,
    form.head === branch,
    `head "${form.head}"`
  );
  report.verdict(
    `${label} lane: form base is the lane's target_ref without the remote`,
    form.base === expectedBase,
    `base "${form.base}", expected "${expectedBase}"`
  );
  report.verdict(
    `${label} lane: title and description prefilled as before`,
    form.title === itemName && form.body === '',
    `title "${form.title}", description "${form.body}"`
  );
  return form;
}
