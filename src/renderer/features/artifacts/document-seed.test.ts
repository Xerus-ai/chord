import { describe, expect, it } from 'vitest';
import { decideDocumentSeed, decideSeedTiming, joinsCollabServer } from './document-seed';

/**
 * The file is a seed only: applied once, and only to a genuinely empty
 * document. Every outcome is a decision — an absent seed (a teammate's cloud
 * document, an empty file) must still settle the document so it reports
 * ready, instead of leaving it undecided forever.
 */
describe('decideDocumentSeed', () => {
  it('applies a seed to an empty document', () => {
    expect(decideDocumentSeed({ seed: '<p>hello</p>', documentEmpty: true })).toBe('apply-seed');
  });

  it('never overwrites a document that already has content', () => {
    expect(decideDocumentSeed({ seed: '<p>hello</p>', documentEmpty: false })).toBe(
      'keep-document'
    );
  });

  it('settles an empty document with no seed as kept (cloud source, empty file)', () => {
    expect(decideDocumentSeed({ seed: '', documentEmpty: true })).toBe('keep-document');
  });

  it('settles a synced document with no seed as kept (teammate opening a shared doc)', () => {
    expect(decideDocumentSeed({ seed: '', documentEmpty: false })).toBe('keep-document');
  });
});

/**
 * When the seed decision may run. A document with no cloud copy has no room
 * on the collab server — the server refuses it — so waiting for a server sync
 * left the tab blank until a failsafe timer (the "Add `notes.txt`" plan tab,
 * design 2026-09-26 §7 bug 1). Such a document decides as soon as its local
 * copy (IndexedDB) has loaded.
 */
describe('decideSeedTiming', () => {
  it('decides at once when there is no collaborative document at all', () => {
    expect(
      decideSeedTiming({
        hasRoom: false,
        joinsServer: false,
        serverSynced: false,
        localLoaded: false,
      })
    ).toBe('decide-now');
  });

  it('waits for the server copy of a room the server holds', () => {
    const base = { hasRoom: true, joinsServer: true, localLoaded: true };
    expect(decideSeedTiming({ ...base, serverSynced: false })).toBe('wait');
    expect(decideSeedTiming({ ...base, serverSynced: true })).toBe('decide-now');
  });

  it('does not wait for a server that has no room: the local copy is enough', () => {
    const base = { hasRoom: true, joinsServer: false, serverSynced: false };
    expect(decideSeedTiming({ ...base, localLoaded: false })).toBe('wait');
    expect(decideSeedTiming({ ...base, localLoaded: true })).toBe('decide-now');
  });
});

describe('joinsCollabServer', () => {
  it('joins only for a signed-in viewer of an artifact the cloud has', () => {
    expect(joinsCollabServer({ signedIn: true, hasCloudCopy: true })).toBe(true);
    expect(joinsCollabServer({ signedIn: true, hasCloudCopy: false })).toBe(false);
    expect(joinsCollabServer({ signedIn: false, hasCloudCopy: true })).toBe(false);
  });
});
