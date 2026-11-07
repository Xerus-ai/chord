import { waitFor } from './sharing-accounts.mjs';

const settles = (promise) =>
  promise.then(
    () => true,
    () => false
  );

/**
 * Check 8i (user decision 2026-10-01), the teammate a Can view member on the
 * owner's chat tab: their composer is the owner's composer, blocked. The
 * read-only reason is its placeholder, and a disabled toolbar shows what the
 * owner's own composer shows: its model pill (the model, or the agent when
 * the model is unlisted) and its permission mode, published with the chat
 * (session registry `model_label`, `permission_mode_label`).
 */
export async function runTeammateComposerChecks({ author, mate, workItemId, results, shot }) {
  const { check } = results;
  const { page } = mate.instance;
  const itemPath = `/work-items/${workItemId}`;

  let chat = null;
  const published = await settles(
    waitFor(
      async () => {
        const sessions = (await author.api('GET', itemPath)).body?.sessions ?? [];
        chat = sessions.find((s) => s.status !== 'done') ?? null;
        return !!chat?.permission_mode_label;
      },
      60_000,
      'the owner’s mode in the session registry'
    )
  );

  // What the owner's composer shows, read off its own pills.
  const ownerPage = author.instance.page;
  await ownerPage
    .locator('[aria-label^="End session "]')
    .first()
    .locator('xpath=ancestor::*[@title][1]')
    .click({ position: { x: 24, y: 12 }, timeout: 30_000 });
  const pillLabel = async (prefix) =>
    (
      (await ownerPage.locator(`[aria-label^="${prefix}"]`).first().getAttribute('aria-label')) ??
      ''
    )
      .slice(prefix.length)
      .trim();
  const ownerModel = await pillLabel('Model — ');
  const ownerMode = await pillLabel('Permission mode — ');

  const toolbar = page.locator('[data-testid="composer-owner-agent"]').first();
  const shown = await settles(toolbar.waitFor({ timeout: 30_000 }));
  const text = shown ? (await toolbar.innerText()).replace(/\s+/g, ' ') : '';
  const pills = toolbar.locator('button');
  const pillCount = shown ? await pills.count() : 0;
  let allDisabled = pillCount > 0;
  for (let i = 0; i < pillCount; i++) {
    if (!(await pills.nth(i).isDisabled())) allDisabled = false;
  }
  const placeholder =
    (await page.getByPlaceholder(/^Read-only access/).count()) > 0 ? 'read-only' : 'other';
  await shot(mate, 'teammate-composer');
  check(
    '8i  the teammate’s composer shows the owner’s agent, model and mode, disabled',
    published &&
      shown &&
      allDisabled &&
      !!ownerModel &&
      text.includes(ownerModel) &&
      text.includes(ownerMode) &&
      placeholder === 'read-only',
    JSON.stringify({
      published: chat && { model: chat.model_label, mode: chat.permission_mode_label },
      owner: { model: ownerModel, mode: ownerMode },
      text,
      pillCount,
      allDisabled,
      placeholder,
    })
  );
}
