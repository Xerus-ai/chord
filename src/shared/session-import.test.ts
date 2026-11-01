import { describe, expect, it } from 'vitest';
import { listAgentsUnableToImport, sessionImportSource } from './session-import';

/**
 * Which agents a lane can import sessions from (plan §Phase 3 slice 5; spike
 * S6): Claude through its transcripts, Codex through the app-server, and the
 * ACP agents Chord runs over ACP, capability-checked when listed. Every other
 * agent runs in a terminal only and has no API to list or load a session.
 */
describe('sessionImportSource', () => {
  it('reads Claude from its transcripts and Codex from the app-server', () => {
    expect(sessionImportSource('claude')).toBe('claude');
    expect(sessionImportSource('codex')).toBe('codex');
  });

  it('asks the ACP agents Chord runs over ACP', () => {
    expect(sessionImportSource('opencode')).toBe('acp');
    expect(sessionImportSource('qwen')).toBe('acp');
    expect(sessionImportSource('copilot')).toBe('acp');
    expect(sessionImportSource('goose')).toBe('acp');
  });

  it('has no source for a terminal-only agent', () => {
    expect(sessionImportSource('gemini')).toBeNull();
    expect(sessionImportSource('cursor')).toBeNull();
  });
});

describe('listAgentsUnableToImport', () => {
  it('names the 19 terminal-only agents once, in registry order', () => {
    const unable = listAgentsUnableToImport();
    expect(unable.map((agent) => agent.providerId)).toEqual([
      'devin',
      'cursor',
      'gemini',
      'droid',
      'amp',
      'hermes',
      'charm',
      'auggie',
      'kimi',
      'kilocode',
      'kiro',
      'rovo',
      'cline',
      'continue',
      'codebuff',
      'mistral',
      'pi',
      'autohand',
      'roo',
    ]);
    expect(unable.find((agent) => agent.providerId === 'gemini')?.name).toBe('Gemini');
    expect(unable.find((agent) => agent.providerId === 'rovo')?.name).toBe('Rovo Dev');
  });
});
