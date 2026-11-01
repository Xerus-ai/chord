import { describe, expect, it } from 'vitest';
import { artifactTypeForPath, renderClassForArtifactType } from './artifact-render-class';

/**
 * Design 2026-09-24 §9 decision 2: a rich document (`.mdx`) is a page — viewed
 * off the author's device through its uploaded view, never a Yjs document.
 * §10 decision 1: binary files (`.pdf/.docx/.pptx`, images) are `file` — never
 * a Yjs document either.
 */
describe('renderClassForArtifactType', () => {
  it('renders mdx as a page', () => {
    expect(renderClassForArtifactType('mdx')).toBe('page');
  });

  it.each([
    ['web', 'page'],
    ['prototype', 'page'],
    ['markdown', 'document'],
    ['text', 'document'],
    ['document', 'file'],
    ['image', 'file'],
  ] as const)('renders %s as %s', (type, renderClass) => {
    expect(renderClassForArtifactType(type)).toBe(renderClass);
  });
});

/** Which artifact format a file would be, by extension — shared by main and the path tab. */
describe('artifactTypeForPath', () => {
  it.each([
    ['docs/plan.md', 'markdown'],
    ['notes.txt', 'text'],
    ['deck/Intro.MDX', 'mdx'],
    ['site/index.html', 'web'],
    ['ui/Hero.tsx', 'prototype'],
    ['ui/Card.jsx', 'prototype'],
    ['report.pdf', 'document'],
    ['brief.docx', 'document'],
    ['pitch.pptx', 'document'],
    ['shot.PNG', 'image'],
    ['photo.jpeg', 'image'],
    ['logo.svg', 'image'],
  ] as const)('%s is %s', (filePath, type) => {
    expect(artifactTypeForPath(filePath)).toBe(type);
  });

  it('is null for anything else, including a dot only in a directory name', () => {
    expect(artifactTypeForPath('src/main.ts')).toBeNull();
    expect(artifactTypeForPath('Makefile')).toBeNull();
    expect(artifactTypeForPath('v1.2/README')).toBeNull();
  });
});
