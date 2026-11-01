/**
 * The bell, as the notifications done-check (shared-items-notifications.mjs)
 * drives it: open it, find a row by its text, read the unread count.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor } from './sharing-accounts.mjs';
import { SHOT_DIR } from './teammate-ui-helpers.mjs';

const dropdown = (page) => page.locator('[data-testid="notification-dropdown"]');

export async function openBell(account) {
  const { page } = account.instance;
  if (await dropdown(page).isVisible()) return;
  await page.locator('button[aria-label="Notifications"]').first().click();
  await dropdown(page).waitFor({ timeout: 10_000 });
}

export async function closeBell(account) {
  const { page } = account.instance;
  if (!(await dropdown(page).isVisible())) return;
  await page.keyboard.press('Escape');
  if (await dropdown(page).isVisible()) {
    await page.mouse.click(5, 400);
  }
}

/** The bell's row whose text includes `text`, once it shows (the bell is opened first). */
export async function waitForBellRow(account, text, timeoutMs = 30_000) {
  const { page } = account.instance;
  await openBell(account);
  const row = dropdown(page).locator('[data-testid="notification-row"]').filter({ hasText: text });
  await waitFor(async () => (await row.count()) > 0, timeoutMs, `a bell row with "${text}"`);
  return row.first();
}

export async function bellRowCount(account, text) {
  const { page } = account.instance;
  await openBell(account);
  return dropdown(page)
    .locator('[data-testid="notification-row"]')
    .filter({ hasText: text })
    .count();
}

/** The unread count in the bell's header; 0 when it shows none. */
export async function bellUnreadCount(account) {
  const { page } = account.instance;
  await openBell(account);
  const header = dropdown(page).locator('span.rounded-full').first();
  if ((await header.count()) === 0) return 0;
  return Number(await header.innerText());
}

/** The notifications the server holds for this account (GET /notifications). */
export async function serverNotifications(account) {
  const res = await account.api('GET', '/notifications');
  if (res.status !== 200) throw new Error(`GET /notifications: ${res.status}`);
  return res.body;
}

export async function waitForServerNotification(account, predicate, what, timeoutMs = 30_000) {
  let found = null;
  await waitFor(
    async () => {
      found = (await serverNotifications(account)).find(predicate) ?? null;
      return found !== null;
    },
    timeoutMs,
    what
  );
  return found;
}

export async function shot(account, name) {
  mkdirSync(SHOT_DIR, { recursive: true });
  // Past the dropdown's fade-in, so the shot shows it as it rests.
  await account.instance.page.waitForTimeout(400);
  await account.instance.page.screenshot({ path: join(SHOT_DIR, `shared-notify-${name}.png`) });
}

/**
 * Closes every WebSocket the renderer holds, found through DevTools'
 * queryObjects: a dropped connection as the app sees it (onclose, then its
 * own reconnect). Returns how many were closed.
 */
export async function closeRendererSockets(page) {
  const cdp = await page.context().newCDPSession(page);
  const { result: prototype } = await cdp.send('Runtime.evaluate', {
    expression: 'WebSocket.prototype',
  });
  const { objects } = await cdp.send('Runtime.queryObjects', {
    prototypeObjectId: prototype.objectId,
  });
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objectId,
    functionDeclaration:
      'function () { const open = this.filter((s) => s.readyState === 1); open.forEach((s) => s.close()); return open.length; }',
    returnByValue: true,
  });
  await cdp.detach();
  return result.value;
}
