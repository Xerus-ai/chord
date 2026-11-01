import { Router, type Request } from 'express';
import { recordAccessEvent } from '../access/record-access-event.js';
import { resolvePublicLink, type PublicLinkTarget } from '../access/resolve-public-link.js';
import { selectArtifactFile, selectArtifactView } from '../artifact-version-reads.js';
import { escapeHtml, FRAME_CSP, GENERIC_CARD, renderShell, sendHtml } from './html.js';
import { loadPublicContent, type PublicContent } from './load-public-content.js';
import { publicFileName, sendPublicFile } from './public-file-response.js';

const DESCRIPTION_LENGTH = 200;

function publicUrl(req: Request): string {
  const origin = process.env.SYNC_SERVER_URL;
  if (!origin) throw new Error('[web] SYNC_SERVER_URL is not configured');
  return `${origin.replace(/\/+$/, '')}${req.baseUrl}${req.path === '/' ? '' : req.path}`;
}

function describe(target: PublicLinkTarget, content: PublicContent): string {
  if (content.kind === 'document' && content.text) {
    return content.text.length > DESCRIPTION_LENGTH
      ? `${content.text.slice(0, DESCRIPTION_LENGTH - 1)}…`
      : content.text;
  }
  return target.name;
}

function renderBody(
  path: string,
  name: string,
  content: PublicContent
): { body: string; mainClass?: string } {
  if (content.kind === 'document') {
    return { body: content.html || '<p class="note">This document is empty.</p>' };
  }
  if (content.kind === 'page') {
    return {
      body: `<iframe sandbox="allow-scripts" src="${escapeHtml(path)}/frame" title="Artifact"></iframe>`,
      mainClass: 'page',
    };
  }
  if (content.kind === 'file' && content.inline) {
    // No sandbox attribute: Chromium's PDF viewer is blocked inside one. The
    // response carries the frame CSP, sandbox included (public-file-response.ts).
    return {
      body: `<iframe src="${escapeHtml(path)}/file" title="${escapeHtml(name)}"></iframe>`,
      mainClass: 'page',
    };
  }
  if (content.kind === 'file') {
    const fileName = publicFileName(name, content.mimeType);
    return {
      body: `<p><a href="${escapeHtml(path)}/file" download>Download ${escapeHtml(fileName)}</a></p>`,
    };
  }
  return { body: `<p class="note">${escapeHtml(content.reason)}</p>` };
}

/**
 * GET /p/:token — a public artifact, signed out and read-only (P6). The host
 * page never runs script; a web page's own script runs only in the frame,
 * under the P1a sandbox. Every lookup goes through resolvePublicLink, so a
 * revoked link, an artifact no longer set to "Anyone with the link" or a team
 * that turned public links off is a plain 404. Each open is audited.
 */
export function createPublicLinkRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req: Request<{ token: string }>, res) => {
    const target = await resolvePublicLink(req.params.token);
    if (!target) {
      sendNotFound(res);
      return;
    }
    await recordAccessEvent({
      workItemId: target.workItemId,
      artifactId: target.artifactId,
      actorId: null,
      action: 'link_opened',
    });

    const content = await loadPublicContent(target);
    const path = `${req.baseUrl}`;
    const { body, mainClass } = renderBody(path, target.name, content);
    const html = renderShell({
      title: target.name,
      card: { title: target.name, description: describe(target, content), url: publicUrl(req) },
      header: `<span class="name">${escapeHtml(target.name)}</span><a href="chord://open/p/${escapeHtml(req.params.token)}">Open in Chord to comment</a>`,
      body,
      mainClass,
    });
    sendHtml(res, 200, html);
  });

  // The page's latest view, served verbatim under the sandbox CSP — never the
  // host page's. An image or docx file is shown through its view too (§10). A
  // document has no view, so it has no frame.
  router.get('/frame', async (req: Request<{ token: string }>, res) => {
    const target = await resolvePublicLink(req.params.token);
    const view =
      target?.renderClass === 'page' || target?.renderClass === 'file'
        ? await selectArtifactView(target.artifactId, target.workItemId, null)
        : null;
    if (!view) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': FRAME_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      })
      .send(view.html);
  });

  // A file artifact's latest bytes (§10): a pdf inline, anything else as a download.
  router.get('/file', async (req: Request<{ token: string }>, res) => {
    const target = await resolvePublicLink(req.params.token);
    const file =
      target?.renderClass === 'file'
        ? await selectArtifactFile(target.artifactId, target.workItemId, null)
        : null;
    if (!target || !file) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    sendPublicFile(res, target.name, file);
  });

  // The same content as JSON, for the desktop's public-artifact viewer.
  router.get('/content', async (req: Request<{ token: string }>, res) => {
    const target = await resolvePublicLink(req.params.token);
    if (!target) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const content = await loadPublicContent(target);
    res.json({
      name: target.name,
      render_class: target.renderClass,
      content_type: target.contentType,
      comments_enabled: target.commentsEnabled,
      html: content.kind === 'document' ? content.html : null,
      frame_path: content.kind === 'page' ? `${req.baseUrl}/frame` : null,
      mime_type: content.kind === 'page' || content.kind === 'file' ? content.mimeType : null,
      file_path:
        content.kind === 'file' || (content.kind === 'page' && content.mimeType !== null)
          ? `${req.baseUrl}/file`
          : null,
      unavailable_reason: content.kind === 'unavailable' ? content.reason : null,
    });
  });

  return router;
}

function sendNotFound(res: Parameters<typeof sendHtml>[0]): void {
  sendHtml(
    res,
    404,
    renderShell({
      title: 'Not found',
      card: GENERIC_CARD,
      header: '<span class="name">Chord</span>',
      body: '<p>This link doesn’t work. It may have been turned off by its author or their team.</p>',
    })
  );
}
