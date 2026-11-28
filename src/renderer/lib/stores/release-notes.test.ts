import { describe, expect, it } from 'vitest';
import { releaseNotesText } from './release-notes';

/**
 * The release notes an update manifest carries (devstation-haay, design F21). electron-updater
 * hands them as markdown, as a list of per-version notes (full changelog mode) or as null. The
 * bugs these catch: a list shown as "[object Object]", and an empty or blank note shown as a
 * "What's new" heading over nothing.
 */
describe('releaseNotesText', () => {
  it('reads markdown as it is, trimmed', () => {
    expect(releaseNotesText({ releaseNotes: '\n### Features\n\n- one\n' })).toBe(
      '### Features\n\n- one'
    );
  });

  it('joins a list of per-version notes, newest first as given', () => {
    expect(
      releaseNotesText({
        releaseNotes: [
          { version: '1.2.0', note: '- two' },
          { version: '1.1.0', note: '- one' },
        ],
      })
    ).toBe('- two\n\n- one');
  });

  it('reads null, a missing field, blank text and empty notes as none', () => {
    expect(releaseNotesText({ releaseNotes: null })).toBeNull();
    expect(releaseNotesText({})).toBeNull();
    expect(releaseNotesText({ releaseNotes: '  \n ' })).toBeNull();
    expect(releaseNotesText({ releaseNotes: [{ version: '1.0.0', note: null }] })).toBeNull();
  });
});
