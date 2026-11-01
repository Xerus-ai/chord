import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeToolInputPaths } from './normalize-tool-input-paths';

const CWD = join('/work', 'repo');

describe('normalizeToolInputPaths', () => {
  it('anchors the publish_artifact path on the session workspace', () => {
    expect(
      normalizeToolInputPaths('mcp__chord__publish_artifact', { path: 'plan.md' }, CWD)
    ).toEqual({ path: join(CWD, 'plan.md') });
  });

  it('leaves the other publish_artifact arguments alone', () => {
    expect(
      normalizeToolInputPaths(
        'mcp__chord__publish_artifact',
        { path: 'plan.md', title: 'Plan', format: 'markdown' },
        CWD
      )
    ).toEqual({ path: join(CWD, 'plan.md'), title: 'Plan', format: 'markdown' });
  });

  it('has nothing to translate for list_artifacts', () => {
    expect(normalizeToolInputPaths('mcp__chord__list_artifacts', {}, CWD)).toBeNull();
  });
});
