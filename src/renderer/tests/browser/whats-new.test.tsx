/**
 * The in-app what's new (devstation-haay, design F21) in real Chromium: with an update found,
 * Settings > Updates shows the release notes the update manifest carries, behind feature flag
 * whats_new. The bugs these catch: notes shown while the flag is off (unfinished work leaking),
 * a "What's new" heading over nothing, and notes that disappear once the download starts.
 *
 * Only the preload bridge is supplied: invoke answers the feature flags and the app version.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@renderer/index.css';
import { mount, unmountAll } from './mount';

let flags: Record<string, boolean> = { whats_new: true };

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'app.getFeatureFlags') return flags;
      if (channel === 'app.getAppVersion') return '1.1.0';
      throw new Error(`the card asked the main process for ${channel}`);
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { UpdateCard } = await import('@renderer/features/settings/components/UpdateCard');
const { useUpdateStore } = await import('@renderer/lib/stores/update-store');

const NOTES = '### Features\n\n- **sync:** shared items open offline';

afterEach(() => {
  unmountAll();
  flags = { whats_new: true };
  useUpdateStore.setState({
    state: { status: 'idle' },
    availableVersion: undefined,
    releaseNotes: null,
  });
});

function found(releaseNotes: string | null) {
  useUpdateStore.setState({
    state: { status: 'available', info: { version: '1.2.0' } },
    availableVersion: '1.2.0',
    releaseNotes,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe("what's new in Settings > Updates", () => {
  it('shows the notes of the update found, under its version', async () => {
    found(NOTES);
    const view = mount(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toContain("What's new in v1.2.0"));
    expect(view.textContent).toContain('shared items open offline');
    expect(view.querySelector('h3, h4, h5')?.textContent).toContain('Features');
  });

  it('keeps showing them while the update downloads and once it is ready', async () => {
    found(NOTES);
    useUpdateStore.setState({ state: { status: 'downloading', progress: { percent: 40 } } });
    const downloading = mount(<UpdateCard />);
    await vi.waitFor(() => expect(downloading.textContent).toContain("What's new in v1.2.0"));
    unmountAll();

    useUpdateStore.setState({ state: { status: 'downloaded' } });
    const ready = mount(<UpdateCard />);
    await vi.waitFor(() => expect(ready.textContent).toContain("What's new in v1.2.0"));
  });

  it('shows nothing while the whats_new flag is off', async () => {
    flags = { whats_new: false };
    found(NOTES);
    const view = mount(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toContain('Version'));
    await settle();
    expect(view.textContent).not.toContain("What's new");
    expect(view.textContent).not.toContain('shared items open offline');
  });

  it('shows no heading for an update without notes', async () => {
    found(null);
    const view = mount(<UpdateCard />);
    await vi.waitFor(() => expect(view.textContent).toContain('Version'));
    await settle();
    expect(view.textContent).not.toContain("What's new");
  });
});
