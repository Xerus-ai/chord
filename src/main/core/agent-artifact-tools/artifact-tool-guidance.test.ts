import { describe, expect, it } from 'vitest';
import { buildPublishArtifactDescription } from './artifact-tool-guidance';

/**
 * What the agent is told about publishing (devstation-fo4u). Told to publish
 * deliverables and, when unsure, to offer, Claude ended every file-writing
 * turn by explaining why the file was not worth publishing. The guidance
 * keeps the rule and asks for silence about a file it does not publish.
 */
describe('buildPublishArtifactDescription', () => {
  const description = buildPublishArtifactDescription('best-fit');

  it('asks the agent to say nothing about a file it does not publish', () => {
    expect(description).toMatch(/do not mention/i);
  });

  it('no longer asks the agent to offer publishing whenever it is unsure', () => {
    expect(description).not.toMatch(/when unsure, answer in chat and offer to publish/i);
  });

  it('still names what is worth publishing and what is not', () => {
    expect(description).toMatch(/plans, specs, reports/);
    expect(description).toMatch(/scratch notes/);
  });
});
