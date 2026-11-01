/**
 * An agent row in Settings → Agents shows the installed version, and when a
 * newer release is known, "installed → latest" with an Update button
 * (devstation-ext). A failed update shows its error under the row with the
 * command output folded away behind "Show output".
 *
 * The real components render in real Chromium; the update check result they
 * get is the shape the main process returns (`AgentUpdateInfo`).
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentUpdateInfo } from '@shared/agent-updates';
import {
  AgentUpdateButton,
  AgentUpdateError,
  AgentVersion,
} from '@renderer/features/settings/components/agent-update-status';

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

function codexUpdate(overrides: Partial<AgentUpdateInfo> = {}): AgentUpdateInfo {
  return {
    id: 'codex',
    installedVersion: '0.154.0',
    latestVersion: '0.160.0',
    updateAvailable: true,
    source: { kind: 'codex-channel', url: 'https://releases.openai.com/codex/channels/latest' },
    checkedAt: Date.now(),
    ...overrides,
  };
}

/** Whether some element showing `text` is on screen (present and not hidden). */
function isShown(container: HTMLElement, text: string): boolean {
  return [...container.querySelectorAll<HTMLElement>('*')].some(
    (el) => el.textContent?.includes(text) && el.children.length === 0 && el.checkVisibility()
  );
}

describe('AgentVersion', () => {
  it('shows installed → latest when a newer release is out', () => {
    const el = render(<AgentVersion installedVersion="0.154.0" update={codexUpdate()} />);

    expect(el.textContent).toContain('0.154.0 → 0.160.0');
  });

  it('shows only the installed version when it is the latest', () => {
    const el = render(
      <AgentVersion
        installedVersion="0.160.0"
        update={codexUpdate({ installedVersion: '0.160.0', updateAvailable: false })}
      />
    );

    expect(el.textContent).toContain('0.160.0');
    expect(el.textContent).not.toContain('→');
  });

  it('shows only the installed version for an agent with no update check', () => {
    const el = render(<AgentVersion installedVersion="2.1.288" update={undefined} />);

    expect(el.textContent).toContain('2.1.288');
    expect(el.textContent).not.toContain('→');
  });
});

describe('AgentUpdateButton', () => {
  it('offers Update when a newer release is out, and runs it on click', () => {
    const onUpdate = vi.fn();
    const el = render(
      <AgentUpdateButton
        agentName="Codex"
        update={codexUpdate()}
        isUpdating={false}
        onUpdate={onUpdate}
      />
    );

    const button = el.querySelector<HTMLButtonElement>('button');
    expect(button?.textContent).toContain('Update');
    expect(button?.getAttribute('aria-label')).toBe('Update Codex to 0.160.0');
    button!.click();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when the agent is up to date', () => {
    const el = render(
      <AgentUpdateButton
        agentName="Codex"
        update={codexUpdate({ installedVersion: '0.160.0', updateAvailable: false })}
        isUpdating={false}
        onUpdate={vi.fn()}
      />
    );

    expect(el.querySelector('button')).toBeNull();
  });

  it('is disabled and says so while the update runs', () => {
    const onUpdate = vi.fn();
    const el = render(
      <AgentUpdateButton agentName="Codex" update={codexUpdate()} isUpdating onUpdate={onUpdate} />
    );

    const button = el.querySelector<HTMLButtonElement>('button');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe('Updating Codex…');
    button!.click();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('AgentUpdateError', () => {
  it('shows the error with its output folded until “Show output” is opened', async () => {
    const el = render(
      <AgentUpdateError
        agentName="Codex"
        message="Install command failed."
        output="Could not detect the Codex installation method."
      />
    );

    expect(el.textContent).toContain('Codex update failed');
    expect(el.textContent).toContain('Install command failed.');
    expect(isShown(el, 'Could not detect the Codex installation method.')).toBe(false);

    const toggle = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Show output')
    );
    expect(toggle).toBeDefined();
    toggle!.click();

    await vi.waitFor(() =>
      expect(isShown(el, 'Could not detect the Codex installation method.')).toBe(true)
    );
  });
});
