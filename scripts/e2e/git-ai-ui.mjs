/**
 * UI steps for `git-ai.mjs`: Settings › Git › AI, the band's commit field and
 * its Generate button, and Generate in Create PR.
 */
import { waitFor } from './sharing/sharing-accounts.mjs';

/** Settings › Git, scrolled to the AI card. */
export async function openGitAiSettings(page) {
  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Git', exact: true }).first().click();
  const agent = page.getByRole('group', { name: 'Git AI agent' });
  await agent.waitFor({ timeout: 15_000 });
  await agent.scrollIntoViewIfNeeded();
  return agent;
}

/** Picks the agent in Settings › Git › AI and waits until it is stored. */
export async function pickGitAiAgent(account, page, label, agentId) {
  const agent = await openGitAiSettings(page);
  await agent.getByRole('button', { name: label, exact: true }).click();
  await waitFor(
    async () => (await account.call('gitAi.getSettings', { repoId: null })).value.agent === agentId,
    10_000,
    `Settings › Git › AI to store ${agentId}`
  );
}

/** Opens the work item and the band's commit field; returns its dialog, textbox and Generate. */
export async function openCommitField(page, workItemName) {
  await page.getByText(workItemName, { exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Commit message' });
  if (!(await dialog.isVisible())) {
    await waitFor(
      async () => {
        const commit = page.getByRole('button', { name: 'Commit', exact: true });
        if (!(await commit.isVisible()) || !(await commit.isEnabled())) return false;
        await commit.click();
        return true;
      },
      60_000,
      'the band to offer Commit'
    );
  }
  await dialog.waitFor({ timeout: 15_000 });
  return {
    dialog,
    message: dialog.getByRole('textbox', { name: 'Commit message' }),
    generate: dialog.locator('button[data-git-ai-generate]'),
  };
}

/** The Generate button's visible label once the agent's status has been read. */
export async function readSettledLabel(button) {
  let label = '';
  await waitFor(
    async () => {
      label = (await button.innerText()).trim();
      const title = (await button.getAttribute('title')) ?? '';
      return !/^Checking /.test(title);
    },
    60_000,
    'the agent check to settle'
  );
  return label;
}

/** Clicks Generate and waits for the run to end (the button is Generate again). */
export async function runGenerate(button, timeoutMs = 180_000) {
  await button.click();
  await waitFor(
    async () => (await button.innerText()).trim() === 'Cancel',
    10_000,
    'Generate to show progress (Cancel)'
  );
  await waitFor(
    async () => (await button.innerText()).trim() === 'Generate',
    timeoutMs,
    'the agent to answer'
  );
}

/** The failure notice under a field: its reason and the agent output block, if any. */
export async function readFailure(scope) {
  const alert = scope.locator('[data-git-ai-failure]');
  if ((await alert.count()) === 0) return null;
  const output = alert.getByLabel('Agent output');
  return {
    reason: (await alert.locator('[data-git-ai-reason]').innerText()).trim(),
    output: (await output.count()) > 0 ? (await output.innerText()).trim() : null,
  };
}
