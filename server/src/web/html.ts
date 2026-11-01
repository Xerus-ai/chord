import type { Response } from 'express';

/** HTML escaping and the page shell for the server's few web pages (P6). */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const escapeAttribute = escapeHtml;

export interface OpenGraphCard {
  title: string;
  description: string;
  url: string | null;
}

/** "Chord" with no title or description: what every non-public link unfurls as. */
export const GENERIC_CARD: OpenGraphCard = {
  title: 'Chord',
  description: 'Open this in Chord.',
  url: null,
};

/**
 * Host pages never run script. A public page's own script runs only inside
 * its sandboxed frame (/p/:token/frame), from this same origin but with an
 * opaque origin of its own.
 */
const HOST_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "frame-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The P1a page sandbox (main/app/protocol.ts), minus the desktop-only scheme.
 * Framed only by this server's own host page (/p/:token), never by another site.
 */
export const FRAME_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

const STYLES = `
  :root { color-scheme: light dark; }
  body { margin: 0; font: 15px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; }
  header { padding: 14px 24px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); display: flex; gap: 16px; align-items: center; }
  header .name { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header a { color: inherit; font-size: 13px; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 24px 64px; }
  main.page { max-width: none; padding: 0; }
  iframe { border: 0; width: 100%; height: calc(100vh - 52px); display: block; }
  .note { opacity: 0.65; font-style: italic; }
  pre { overflow-x: auto; padding: 12px; border-radius: 6px; background: color-mix(in srgb, currentColor 8%, transparent); }
  table { border-collapse: collapse; } td, th { border: 1px solid color-mix(in srgb, currentColor 20%, transparent); padding: 4px 8px; }
`;

export function renderShell(args: {
  title: string;
  card: OpenGraphCard;
  header: string;
  body: string;
  mainClass?: string;
  /** Navigates here on load (the desktop handoff) — a meta refresh, no script. */
  redirectTo?: string;
}): string {
  const { card } = args;
  const meta = [
    `<meta property="og:title" content="${escapeAttribute(card.title)}">`,
    `<meta property="og:description" content="${escapeAttribute(card.description)}">`,
    `<meta property="og:site_name" content="Chord">`,
    `<meta property="og:type" content="website">`,
    card.url ? `<meta property="og:url" content="${escapeAttribute(card.url)}">` : '',
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${escapeAttribute(card.title)}">`,
    `<meta name="twitter:description" content="${escapeAttribute(card.description)}">`,
    `<meta name="robots" content="noindex">`,
    args.redirectTo
      ? `<meta http-equiv="refresh" content="0; url=${escapeAttribute(args.redirectTo)}">`
      : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(args.title)}</title>
    ${meta}
    <style>${STYLES}</style>
  </head>
  <body>
    <header>${args.header}</header>
    <main${args.mainClass ? ` class="${args.mainClass}"` : ''}>${args.body}</main>
  </body>
</html>`;
}

/** Sends a server-rendered page with the host security headers. */
export function sendHtml(res: Response, status: number, html: string): void {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': HOST_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    })
    .send(html);
}
