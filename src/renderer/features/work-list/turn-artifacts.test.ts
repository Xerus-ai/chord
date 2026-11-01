import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import { describeArtifactPath, partitionTurnItems } from './turn-artifacts';

type Item = AgentTurn['items'][number];

const text = (id: string, value: string): Item => ({ kind: 'text', id, text: value });
const artifact = (id: string, artifactId: string, filePath: string): Item => ({
  kind: 'artifact',
  id,
  artifactId,
  filePath,
  title: filePath.split(/[\\/]/).pop() ?? filePath,
  type: 'markdown',
  preview: 'Created by agent',
});
const tool = (id: string): Item => ({ kind: 'tool_group', id, tools: [] });

describe('partitionTurnItems', () => {
  it('moves artifacts out of the body in write order, deduped by artifact id', () => {
    const { body, artifacts } = partitionTurnItems([
      text('t1', 'Wrote the site.'),
      artifact('i1', 'a-index', 'D:/Kami/site/index.html'),
      artifact('i2', 'a-llms', 'D:/Kami/llms.txt'),
      artifact('i3', 'a-index', 'D:/Kami/site/index.html'),
    ]);
    expect(body.map((i) => i.kind)).toEqual(['text']);
    expect(artifacts.map((a) => a.artifactId)).toEqual(['a-index', 'a-llms']);
  });

  it('rejoins a markdown table that artifact cards had split', () => {
    const { body } = partitionTurnItems([
      text('t1', '| File | Purpose |\n|---|---|\n| index.html | '),
      artifact('i1', 'a-index', 'D:/Kami/index.html'),
      artifact('i2', 'a-en', 'D:/Kami/index-en.html'),
      text('t2', 'landing pages per locale |\n| styles.css | Shared site styles |'),
    ]);
    expect(body).toEqual([
      {
        kind: 'text',
        id: 't1',
        text: '| File | Purpose |\n|---|---|\n| index.html | landing pages per locale |\n| styles.css | Shared site styles |',
      },
    ]);
  });

  it('keeps text separated by a tool call as separate items', () => {
    const { body } = partitionTurnItems([
      text('t1', "I'll check the config."),
      tool('g1'),
      text('t2', "It's already set."),
    ]);
    expect(body.map((i) => i.id)).toEqual(['t1', 'g1', 't2']);
  });

  it('does not mutate the stream items it was given', () => {
    const first = text('t1', 'a');
    partitionTurnItems([first, artifact('i1', 'x', 'D:/r/x.md'), text('t2', 'b')]);
    expect(first).toEqual(text('t1', 'a'));
  });
});

describe('describeArtifactPath', () => {
  it('splits a workspace-relative directory from the file name', () => {
    expect(describeArtifactPath('D:\\Kami\\site\\en\\index.html', 'D:\\Kami')).toEqual({
      directory: 'site/en/',
      fileName: 'index.html',
    });
  });

  it('matches the workspace root case-insensitively on Windows drive paths', () => {
    expect(describeArtifactPath('d:/kami/docs/plan.md', 'D:\\Kami\\')).toEqual({
      directory: 'docs/',
      fileName: 'plan.md',
    });
  });

  it('shows no directory for a file at the workspace root', () => {
    expect(describeArtifactPath('/home/me/repo/README.md', '/home/me/repo')).toEqual({
      directory: '',
      fileName: 'README.md',
    });
  });

  it('shows only the file name when no workspace root is known or the path is outside it', () => {
    expect(describeArtifactPath('/tmp/out/report.md', null)).toEqual({
      directory: '',
      fileName: 'report.md',
    });
    expect(describeArtifactPath('/tmp/out/report.md', '/home/me/repo')).toEqual({
      directory: '',
      fileName: 'report.md',
    });
  });

  it('does not treat a sibling folder sharing the root prefix as inside it', () => {
    expect(describeArtifactPath('/home/me/repo-old/a.md', '/home/me/repo')).toEqual({
      directory: '',
      fileName: 'a.md',
    });
  });
});
