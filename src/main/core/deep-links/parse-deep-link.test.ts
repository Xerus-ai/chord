import { describe, expect, it } from 'vitest';
import type { DeepLinkTarget } from '@shared/events/deepLinkEvents';
import { createDeepLinkRouter } from './deep-link-router';
import {
  findProtocolUrlInArgv,
  InvalidDeepLinkError,
  isOpenDeepLink,
  parseOpenDeepLink,
} from './parse-deep-link';

/**
 * `chord://open/…` links from the web landing pages (design 2026-09-24 §5).
 * Parsed strictly: the three documented forms are accepted, anything else is
 * refused with an error that names the link — never guessed at.
 */

const WORK_ITEM_ID = '3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b';
const ARTIFACT_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const TOKEN = 'Qm9vdHN0cmFwLXRva2VuLWZvci1jaG9yZC1saW5rcw';

describe('parseOpenDeepLink', () => {
  it.each<[string, DeepLinkTarget]>([
    [`chord://open/work-item/${WORK_ITEM_ID}`, { kind: 'work-item', workItemId: WORK_ITEM_ID }],
    [`chord://open/artifact/${ARTIFACT_ID}`, { kind: 'artifact', artifactId: ARTIFACT_ID }],
    [`chord://open/p/${TOKEN}`, { kind: 'public-link', token: TOKEN }],
    // Some browsers hand the OS the link with a trailing slash.
    [`chord://open/artifact/${ARTIFACT_ID}/`, { kind: 'artifact', artifactId: ARTIFACT_ID }],
  ])('accepts %s', (url, target) => {
    expect(parseOpenDeepLink(url)).toEqual(target);
  });

  it.each([
    `chord://open/settings/${WORK_ITEM_ID}`,
    'chord://open/work-item/',
    'chord://open/work-item',
    'chord://open/p/',
    `chord://open/work-item/${WORK_ITEM_ID}/extra`,
    `chord://open/work-item/${WORK_ITEM_ID}?next=https://evil.example`,
    `chord://open/artifact/${ARTIFACT_ID}#frag`,
    'chord://open/artifact/..%2F..%2Fetc',
    'chord://open/artifact/a%20b',
    `chord://open/Work-Item/${WORK_ITEM_ID}`,
    `chord://close/work-item/${WORK_ITEM_ID}`,
    `https://open/work-item/${WORK_ITEM_ID}`,
    `chord://open/work-item/${'x'.repeat(200)}`,
    'chord://open/p/short',
    'chord://auth/callback?code=abc',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => parseOpenDeepLink(url)).toThrow(InvalidDeepLinkError);
  });

  it('names the refused link in the error', () => {
    expect(() => parseOpenDeepLink('chord://open/settings/x')).toThrow(
      /chord:\/\/open\/settings\/x/
    );
  });
});

describe('isOpenDeepLink', () => {
  it('routes open links to the deep-link handler and leaves the auth callback alone', () => {
    expect(isOpenDeepLink(`chord://open/work-item/${WORK_ITEM_ID}`)).toBe(true);
    expect(isOpenDeepLink('chord://open/settings/x')).toBe(true);
    expect(isOpenDeepLink('chord://auth/callback?code=abc')).toBe(false);
    expect(isOpenDeepLink('https://open/work-item/x')).toBe(false);
  });
});

describe('findProtocolUrlInArgv', () => {
  it('finds the chord:// argument a cold start or second instance was launched with', () => {
    const url = `chord://open/artifact/${ARTIFACT_ID}`;
    expect(findProtocolUrlInArgv(['C:\\Chord\\Chord.exe', '--', url])).toBe(url);
    expect(findProtocolUrlInArgv(['/Applications/Chord.app/Contents/MacOS/Chord'])).toBeNull();
  });
});

describe('createDeepLinkRouter', () => {
  it('holds links until the renderer claims them, then delivers live', () => {
    const delivered: DeepLinkTarget[] = [];
    const router = createDeepLinkRouter((target) => delivered.push(target));
    const first: DeepLinkTarget = { kind: 'work-item', workItemId: WORK_ITEM_ID };
    const second: DeepLinkTarget = { kind: 'artifact', artifactId: ARTIFACT_ID };
    const third: DeepLinkTarget = { kind: 'public-link', token: TOKEN };

    router.route(first);
    router.route(second);
    expect(delivered).toEqual([]);

    expect(router.claimPending()).toEqual([first, second]);
    // Claimed once; a second claim does not replay them.
    expect(router.claimPending()).toEqual([]);

    router.route(third);
    expect(delivered).toEqual([third]);
  });
});
