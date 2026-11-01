/**
 * A button with a tooltip is one button (devstation-lk24). base-ui's
 * Tooltip.Trigger renders a <button> of its own, so a trigger wrapping a
 * button put a button inside a button: invalid HTML, two tab stops for one
 * control, and a focusable outer element that does nothing. The trigger now
 * renders as the button itself, and a disabled button still shows its tooltip
 * on hover — the reason it is disabled is often what the tooltip says.
 *
 * The real components render in real Chromium.
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FieldTooltip } from '@renderer/features/settings/components/FieldTooltip';
import { ResetToDefaultButton } from '@renderer/features/settings/components/ResetToDefaultButton';
import { AgentInstallButton } from '@renderer/lib/components/agent-selector/agent-install-button';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

/** The control's only button; fails when there is none or more than one. */
function onlyButton(container: HTMLElement): HTMLButtonElement {
  expect(container.querySelectorAll('button button')).toHaveLength(0);
  const buttons = container.querySelectorAll('button');
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

/** Whether a tooltip popup showing `text` is on screen. */
function tooltipShows(text: string): boolean {
  return [...document.querySelectorAll<HTMLElement>('[data-slot="tooltip-content"]')].some(
    (el) => el.textContent?.includes(text) && el.checkVisibility()
  );
}

describe('a settings field tooltip', () => {
  it('is one button, and shows its text on hover', async () => {
    const button = onlyButton(render(<FieldTooltip content="Used for new lanes" />));
    expect(button.getAttribute('aria-label')).toBe('More information');

    await userEvent.hover(button);
    await expect.poll(() => tooltipShows('Used for new lanes')).toBe(true);
  });
});

describe('Reset to default', () => {
  it('is one button that resets on click and names the default on hover', async () => {
    const onReset = vi.fn();
    const button = onlyButton(
      render(<ResetToDefaultButton defaultLabel="main" onReset={onReset} />)
    );

    await userEvent.hover(button);
    await expect.poll(() => tooltipShows('Reset to default: main')).toBe(true);

    await userEvent.click(button);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('disabled, still names the default on hover and does not reset', async () => {
    const onReset = vi.fn();
    const button = onlyButton(
      render(<ResetToDefaultButton defaultLabel="main" onReset={onReset} disabled />)
    );
    expect(button.getAttribute('aria-disabled')).toBe('true');

    await userEvent.hover(button);
    await expect.poll(() => tooltipShows('Reset to default: main')).toBe(true);

    // Playwright's click waits for an enabled element; the DOM click is what
    // a disabled control must ignore.
    button.click();
    expect(onReset).not.toHaveBeenCalled();
  });
});

describe('an agent install button', () => {
  it('is one button that installs on click and names the agent on hover', async () => {
    const onInstall = vi.fn();
    const button = onlyButton(
      render(
        <AgentInstallButton
          agentId="codex"
          canInstall
          isInstalled={false}
          isInstalling={false}
          onInstall={onInstall}
        />
      )
    );

    await userEvent.hover(button);
    await expect.poll(() => tooltipShows('Install Codex')).toBe(true);

    await userEvent.click(button);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('while installing, is disabled but still says what it does on hover', async () => {
    const onInstall = vi.fn();
    const button = onlyButton(
      render(
        <AgentInstallButton
          agentId="codex"
          canInstall
          isInstalled={false}
          isInstalling
          onInstall={onInstall}
        />
      )
    );
    expect(button.getAttribute('aria-disabled')).toBe('true');

    await userEvent.hover(button);
    await expect.poll(() => tooltipShows('Install Codex')).toBe(true);

    button.click();
    expect(onInstall).not.toHaveBeenCalled();
  });
});
