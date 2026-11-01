import { readFile } from 'node:fs/promises';
import { isLiveDocumentType } from '@shared/confluence';
import type { ArtifactType } from '@shared/stream-items';
import {
  registerArtifactPageSource,
  registerArtifactSnippetSource,
  registerEmbeddedMdxSource,
} from '@main/core/artifact-pages/page-source-registry';
import { extractFileName } from '@main/core/artifacts/artifact-utils';
import { splitMdxSections } from './mdx-sections';
import { captureArtifactPageSnapshot } from './snapshot-page';
import { convertHtmlToStorage, type PendingAttachment } from './storage-format';

/**
 * What an artifact publishes as, per format (plan P5 and the 2026-09-24
 * decisions): documents — the live document the editor holds; rich documents
 * — their text plus a PNG per component; web pages — the HTML as an attachment
 * with a link; prototypes — a PNG snapshot.
 */

export interface PublishArtifactSource {
  id: string;
  workItemId: string;
  name: string;
  type: ArtifactType;
  filePath: string;
}

export interface ReadyAttachment {
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface ConfluenceBody {
  /** What the artifact version records: the live document HTML, or the file's source. */
  content: string;
  /** Builds the page — deferred, because rendering snapshots is the slow part. */
  render: () => Promise<{ storage: string; attachments: ReadyAttachment[] }>;
}

async function resolveAttachments(
  artifact: PublishArtifactSource,
  pending: PendingAttachment[]
): Promise<ReadyAttachment[]> {
  const ready: ReadyAttachment[] = [];
  for (const attachment of pending) {
    if (attachment.kind === 'bytes') {
      ready.push(attachment);
      continue;
    }
    const source = registerEmbeddedMdxSource({
      filePath: attachment.filePath,
      workItemId: artifact.workItemId,
    });
    ready.push({
      fileName: attachment.fileName,
      contentType: 'image/png',
      data: await captureArtifactPageSnapshot(source),
    });
  }
  return ready;
}

function renderDocument(artifact: PublishArtifactSource, html: string): ConfluenceBody['render'] {
  return async () => {
    const { storage, attachments } = await convertHtmlToStorage(html);
    return { storage, attachments: await resolveAttachments(artifact, attachments) };
  };
}

function renderRichDocument(
  artifact: PublishArtifactSource,
  source: string
): ConfluenceBody['render'] {
  return async () => {
    const { marked } = await import('marked');
    const snapshots: ReadyAttachment[] = [];
    const html: string[] = [];
    for (const section of await splitMdxSections(source)) {
      if (section.kind === 'markdown') {
        html.push(marked.parse(section.text, { async: false }) as string);
        continue;
      }
      const fileName = `component-${snapshots.length + 1}.png`;
      const page = await registerArtifactSnippetSource({
        artifactId: artifact.id,
        source: section.source,
      });
      snapshots.push({
        fileName,
        contentType: 'image/png',
        data: await captureArtifactPageSnapshot(page),
      });
      html.push(`<chord-attachment-image data-file-name="${fileName}"></chord-attachment-image>`);
    }
    const { storage, attachments } = await convertHtmlToStorage(html.join(''));
    return {
      storage,
      attachments: [...snapshots, ...(await resolveAttachments(artifact, attachments))],
    };
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWebPage(artifact: PublishArtifactSource, source: string): ConfluenceBody['render'] {
  const fileName = extractFileName(artifact.filePath);
  return async () => ({
    storage:
      `<p>This web page was published from Chord. Open it: ` +
      `<ac:link><ri:attachment ri:filename="${escapeXml(fileName)}" />` +
      `<ac:plain-text-link-body><![CDATA[${fileName.replace(/]]>/g, '')}]]></ac:plain-text-link-body></ac:link></p>`,
    attachments: [{ fileName, contentType: 'text/html', data: Buffer.from(source, 'utf-8') }],
  });
}

function renderPrototype(artifact: PublishArtifactSource): ConfluenceBody['render'] {
  return async () => {
    const page = await registerArtifactPageSource(artifact.id);
    const data = await captureArtifactPageSnapshot(page);
    return {
      storage:
        `<p>A snapshot of the interactive prototype <code>${escapeXml(extractFileName(artifact.filePath))}</code>, published from Chord.</p>` +
        `<ac:image><ri:attachment ri:filename="prototype.png" /></ac:image>`,
      attachments: [{ fileName: 'prototype.png', contentType: 'image/png', data }],
    };
  };
}

/**
 * The body for one publish. A document publishes the live document the
 * caller passes (the editor's HTML — edits never reach the file); every other
 * format publishes its file, and passing a document for one is an error.
 */
export async function buildConfluenceBody(
  artifact: PublishArtifactSource,
  documentHtml: string | undefined
): Promise<ConfluenceBody> {
  if (isLiveDocumentType(artifact.type)) {
    if (documentHtml === undefined) {
      throw new Error('Publishing a document needs its live content; open it in Chord to publish.');
    }
    return { content: documentHtml, render: renderDocument(artifact, documentHtml) };
  }
  if (documentHtml !== undefined) {
    throw new Error(`A ${artifact.type} artifact publishes its file, not document content.`);
  }
  const source = await readFile(artifact.filePath, 'utf-8');
  switch (artifact.type) {
    case 'mdx':
      return { content: source, render: renderRichDocument(artifact, source) };
    case 'web':
      return { content: source, render: renderWebPage(artifact, source) };
    case 'prototype':
      return { content: source, render: renderPrototype(artifact) };
    default:
      throw new Error(
        `${artifact.name} is a ${artifact.type} artifact, which Chord cannot publish to Confluence.`
      );
  }
}
