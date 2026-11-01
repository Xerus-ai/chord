import { describe, expect, it } from 'vitest';
import { buildClaudeFlagSettings } from './claude-flag-settings';

describe('buildClaudeFlagSettings', () => {
  it('sets nothing when fast mode is off and Chord artifacts are off', () => {
    expect(buildClaudeFlagSettings({ fast: false, chordArtifactsEnabled: false })).toBeUndefined();
  });

  it('leaves Claude Code’s own Artifact tool to the user while Chord artifacts are off', () => {
    const settings = buildClaudeFlagSettings({ fast: true, chordArtifactsEnabled: false });
    expect(settings).toEqual({ fastMode: true });
    expect(settings).not.toHaveProperty('enableArtifact');
  });

  it('turns the built-in Artifact tool off while Chord artifacts are on', () => {
    expect(buildClaudeFlagSettings({ fast: false, chordArtifactsEnabled: true })).toEqual({
      enableArtifact: false,
    });
  });

  it('carries fast mode and the Artifact switch together', () => {
    expect(buildClaudeFlagSettings({ fast: true, chordArtifactsEnabled: true })).toEqual({
      fastMode: true,
      enableArtifact: false,
    });
  });
});
