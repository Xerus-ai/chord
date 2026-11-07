/**
 * Opens a Run tab row's terminal ("Show terminal") and reads what it holds
 * (devstation-5b3.7: the suites never opened one, so the pane was covered by
 * the browser component test only). The terminal draws on a canvas
 * (`lib/pty/pty.ts`, CanvasAddon), so its text is not in the DOM: the check is
 * that the pane opened and connected, and the process's own buffer, read over
 * the same `pty.subscribe` the pane uses, holds the expected output. The
 * screenshot taken after it is what shows the user's view.
 */
// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '');

/**
 * @param {{ account: { call: Function }, group: import('playwright').Locator, ptySessionId: string }} args
 * @returns {Promise<{ connected: boolean, output: string }>}
 */
export async function openRunTerminal({ account, group, ptySessionId }) {
  await group.getByRole('button', { name: 'Show terminal' }).click();
  await group.getByRole('button', { name: 'Hide terminal' }).waitFor({ timeout: 10_000 });
  // xterm's canvas appears once the pane has connected ("Connecting…" before).
  await group.locator('canvas').first().waitFor({ timeout: 15_000 });
  const failed = await group.getByText('Terminal failed to connect').count();
  const { buffer } = await account.call('pty.subscribe', ptySessionId);
  return { connected: failed === 0, output: stripAnsi(buffer) };
}
