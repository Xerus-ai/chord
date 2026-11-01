import { describe, expect, it } from 'vitest';
import type { AgentProviderDefinition, AgentProviderId } from '@shared/agent-provider-registry';
import { partitionAgents, summarizeProgress } from './onboarding-state';

const provider = (id: AgentProviderId): AgentProviderDefinition => ({ id, name: id });

const ALL = [
  provider('claude'),
  provider('codex'),
  provider('cursor'),
  provider('gemini'),
  provider('opencode'),
];

const ids = (list: AgentProviderDefinition[]) => list.map((p) => p.id);

describe('partitionAgents', () => {
  it('puts detected providers on the machine side and the rest under installable', () => {
    const { onMachine, installable } = partitionAgents([provider('claude')], ALL);
    expect(ids(onMachine)).toEqual(['claude']);
    expect(ids(installable)).toEqual(['codex', 'cursor', 'gemini', 'opencode']);
  });

  it('leaves the machine group empty when nothing is detected', () => {
    const { onMachine, installable } = partitionAgents([], ALL);
    expect(onMachine).toEqual([]);
    expect(ids(installable)).toEqual(ids(ALL));
  });

  it('never lists a detected provider under installable as well', () => {
    const { installable } = partitionAgents([provider('cursor'), provider('gemini')], ALL);
    expect(installable.some((p) => p.id === 'cursor' || p.id === 'gemini')).toBe(false);
  });

  it('keeps a harness-only agent on the machine side even though the registry also lists it', () => {
    // Harness detection appends providers the CLI probe missed; they are still
    // installed on this machine and must not fall through to "available".
    const { onMachine, installable } = partitionAgents(
      [provider('claude'), provider('opencode')],
      ALL
    );
    expect(ids(onMachine)).toEqual(['claude', 'opencode']);
    expect(ids(installable)).toEqual(['codex', 'cursor', 'gemini']);
  });

  it('preserves the order of the detected list', () => {
    const { onMachine } = partitionAgents([provider('gemini'), provider('claude')], ALL);
    expect(ids(onMachine)).toEqual(['gemini', 'claude']);
  });
});

describe('summarizeProgress', () => {
  const step = (done: boolean, extra: { optional?: boolean; pending?: boolean } = {}) => ({
    done,
    optional: extra.optional ?? false,
    pending: extra.pending ?? false,
  });

  it('counts only required steps toward remaining and total', () => {
    const { remaining, total } = summarizeProgress([
      step(true),
      step(false),
      step(false),
      step(false, { optional: true }),
    ]);
    expect(total).toBe(3);
    expect(remaining).toBe(2);
  });

  it('points next at the first unfinished step', () => {
    expect(summarizeProgress([step(true), step(false), step(false)]).nextIndex).toBe(1);
  });

  it('skips a step that is still pending, since there is nothing to act on yet', () => {
    // The agent scan: not done, but the user cannot do anything about it.
    const { nextIndex } = summarizeProgress([
      step(true),
      step(false, { pending: true }),
      step(false),
    ]);
    expect(nextIndex).toBe(2);
  });

  it('lifts an unfinished optional step once every required one is done', () => {
    const { remaining, nextIndex } = summarizeProgress([
      step(true),
      step(true),
      step(false, { optional: true }),
    ]);
    expect(remaining).toBe(0);
    expect(nextIndex).toBe(2);
  });

  it('has no next step when everything is finished', () => {
    expect(summarizeProgress([step(true), step(true, { optional: true })]).nextIndex).toBeNull();
  });
});
