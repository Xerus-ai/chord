import { describe, expect, it } from 'vitest';
import { npmViewVersion } from './_testing/npm-prefix-fixture';
import { CODEX_LATEST_CHANNEL_URL, fetchLatestVersion } from './latest-version';

/**
 * The latest version of an agent CLI comes from the source its own installer
 * uses (devstation-ext), read live — no cached or bundled value:
 *   - a native Codex install: releases.openai.com's `latest` channel, which
 *     Codex's install.ps1/install.sh read (`scripts/install/install.ps1`);
 *   - an npm install: the npm registry's `latest` dist-tag, the version
 *     `npm install -g <pkg>@latest` installs.
 * Each case is checked against an independent read of the same source.
 */
const SEMVER = /^\d+\.\d+\.\d+$/;

describe('fetchLatestVersion — Codex release channel', () => {
  it('reads the channel the native installer reads, without its rust-v tag prefix', async () => {
    const response = await fetch(CODEX_LATEST_CHANNEL_URL);
    const { tag_name } = (await response.json()) as { tag_name: string };

    const latest = await fetchLatestVersion({
      kind: 'codex-channel',
      url: CODEX_LATEST_CHANNEL_URL,
    });

    expect(CODEX_LATEST_CHANNEL_URL).toBe('https://releases.openai.com/codex/channels/latest');
    expect(latest).toMatch(SEMVER);
    expect(`rust-v${latest}`).toBe(tag_name);
  });
});

describe('fetchLatestVersion — npm registry', () => {
  it('reads the same latest version npm itself reports', async () => {
    const latest = await fetchLatestVersion({ kind: 'npm', package: 'marked' });

    expect(latest).toMatch(SEMVER);
    expect(latest).toBe(npmViewVersion('marked'));
  });

  it('reads a scoped package', async () => {
    const latest = await fetchLatestVersion({ kind: 'npm', package: '@openai/codex' });

    expect(latest).toMatch(SEMVER);
    expect(latest).toBe(npmViewVersion('@openai/codex'));
  });

  it('rejects for a package the registry does not have', async () => {
    await expect(
      fetchLatestVersion({ kind: 'npm', package: 'chord-no-such-package-6f1c2e9a' })
    ).rejects.toThrow(/chord-no-such-package-6f1c2e9a.*404/);
  });
});
