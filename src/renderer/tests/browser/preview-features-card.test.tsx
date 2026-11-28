/**
 * The Preview features card (devstation-mg6u.95) in real Chromium. The bugs these catch: a flags
 * read still pending, or one that failed, shown as Off - the same as the server turning the
 * feature off - and On and Off not following main's answer.
 *
 * Only the preload bridge is supplied: invoke answers app.getFeatureFlags as each test sets it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import '@renderer/index.css';
import { mount, unmountAll } from './mount';

let answer: () => Promise<unknown> = () => new Promise(() => {});

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      if (channel === 'app.getFeatureFlags') return answer();
      throw new Error(`the card asked the main process for ${channel}`);
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { PreviewFeaturesCard } = await import(
  '@renderer/features/settings/components/PreviewFeaturesCard'
);

afterEach(() => unmountAll());

const row = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-testid="feature-flag-whats_new"]')!;

describe('Preview features card', () => {
  it('shows neither On nor Off while main has not answered', async () => {
    answer = () => new Promise(() => {});
    const host = mount(<PreviewFeaturesCard />);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(row(host).dataset.state).toBe('pending');
    expect(row(host).textContent).not.toMatch(/\b(On|Off)\b/);
  });

  it('says the read failed instead of showing Off', async () => {
    answer = async () => {
      throw new Error('main is gone');
    };
    const host = mount(<PreviewFeaturesCard />);
    await expect.poll(() => row(host).dataset.state, { timeout: 15_000 }).toBe('error');
    expect(row(host).textContent).toContain('Could not read');
    expect(row(host).textContent).not.toMatch(/\bOff\b/);
  }, 20_000);

  it('shows On and Off as main answers', async () => {
    answer = async () => ({ whats_new: true });
    const on = mount(<PreviewFeaturesCard />);
    await expect.poll(() => row(on).dataset.state).toBe('on');
    expect(row(on).textContent).toContain('On');
    unmountAll();

    answer = async () => ({ whats_new: false });
    const off = mount(<PreviewFeaturesCard />);
    await expect.poll(() => row(off).dataset.state).toBe('off');
    expect(row(off).textContent).toContain('Off');
  });

  // devstation-mg6u.98: a wrapper around each row broke SettingRow's hairline between rows, a
  // row read to assistive tech as loose text, and every row repeated the same description.
  it('each row is a labelled group with no wrapper, under one intro line', async () => {
    answer = async () => ({ whats_new: true });
    const host = mount(<PreviewFeaturesCard />);
    await expect.poll(() => row(host).dataset.state).toBe('on');
    const r = row(host);
    expect(r.hasAttribute('data-setting-row')).toBe(true);
    expect(r.getAttribute('role')).toBe('group');
    expect(r.getAttribute('aria-label')).toBe("What's new");
    const intro = host.textContent ?? '';
    expect(intro.match(/turns this on while the feature is in preview/g) ?? []).toHaveLength(0);
    expect(intro).toMatch(/The Chord server turns these on/);
  });
});
