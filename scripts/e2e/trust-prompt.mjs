/**
 * Answers main's "Run scripts?" window (`trust-prompt-window.ts`) from a
 * suite, as the user would: by clicking one of its links. The window is a
 * BrowserWindow of its own, and Playwright's ElectronApplication sees every
 * window, so no other driver is needed (devstation-b7y: circuit-electron
 * listed the window but acted on the main one).
 *
 * Answers are the page's link names: 'decline' (Don't run), 'run', and
 * 'run-always' (Run scripts, with Always trust checked).
 */

const PROMPT_TITLE = 'Run scripts?';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Looks at least once, then until `deadline`. */
async function findPromptWindow(app, deadline) {
  for (;;) {
    for (const page of app.windows()) {
      if (page.isClosed()) continue;
      if ((await page.title()) === PROMPT_TITLE) return page;
    }
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

/**
 * Waits for the prompt, screenshots it to `shotPath` when given, clicks
 * `answer`, and waits for the window to close. Returns the prompt's text
 * (what it said would run). Throws when no prompt opens within `timeoutMs`.
 */
export async function answerTrustPrompt(app, answer, { timeoutMs = 60_000, shotPath } = {}) {
  if (!['decline', 'run', 'run-always'].includes(answer)) {
    throw new Error(`Unknown trust prompt answer: ${answer}`);
  }
  const prompt = await findPromptWindow(app, Date.now() + timeoutMs);
  if (!prompt) throw new Error(`No "${PROMPT_TITLE}" window opened within ${timeoutMs / 1000}s`);
  await prompt.waitForLoadState('domcontentloaded');
  const text = await prompt.locator('main').innerText();
  if (shotPath) await prompt.screenshot({ path: shotPath });
  const closed = prompt.waitForEvent('close', { timeout: 15_000 });
  await prompt.locator(`a.answer[href$="/${answer}"]`).click();
  await closed;
  return text;
}

/** The "Run scripts?" window once one is open within `timeoutMs`, else null. */
export async function findTrustPrompt(app, timeoutMs) {
  return findPromptWindow(app, Date.now() + timeoutMs);
}

/** True when no "Run scripts?" window is open now. */
export async function isTrustPromptClosed(app) {
  return (await findPromptWindow(app, Date.now())) === null;
}
