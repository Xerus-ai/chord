import { describe, expect, it } from 'vitest';
import { distinguishLabels } from './distinguishing-labels';

/**
 * Labels shown side by side — a pane's tabs, a lane's sessions in the sidebar
 * — that share a long start read alike once cut to fit: two chats titled from
 * "Remember the codeword ALPHA-7…" and "…BRAVO-3…" both showed "Remember the
 * co…" (devstation-6w3p). Each such label starts where it differs instead.
 */
describe('distinguishLabels', () => {
  it('starts labels that share a long start where they differ', () => {
    expect(
      distinguishLabels([
        'Remember the codeword ALPHA-7. Reply with only OK.',
        'Remember the codeword BRAVO-3. Reply with only OK.',
      ])
    ).toEqual(['…ALPHA-7. Reply with only OK.', '…BRAVO-3. Reply with only OK.']);
  });

  it('keeps the whole word where the labels part mid-word', () => {
    expect(
      distinguishLabels(['Investigate the flaky login test', 'Investigate the flaky logout test'])
    ).toEqual(['…login test', '…logout test']);
  });

  it('leaves labels alone when what they share is short', () => {
    const labels = ['Fix login bug', 'Fix logout bug', 'Codex', 'Terminal'];

    expect(distinguishLabels(labels)).toEqual(labels);
  });

  it('only shortens a label against one that shares its start', () => {
    expect(
      distinguishLabels([
        'Remember the codeword ALPHA-7',
        'Remember the codeword BRAVO-3',
        'Review the pull request',
      ])
    ).toEqual(['…ALPHA-7', '…BRAVO-3', 'Review the pull request']);
  });

  it('leaves identical labels and a label that is all of another one’s start whole', () => {
    expect(
      distinguishLabels([
        'Claude Code',
        'Claude Code',
        'Summarise the release notes',
        'Summarise the release notes for 2.0',
      ])
    ).toEqual(['Claude Code', 'Claude Code', 'Summarise the release notes', '…for 2.0']);
  });
});
