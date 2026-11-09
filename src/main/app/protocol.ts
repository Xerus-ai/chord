import { join, normalize, sep } from 'node:path';
import { net, protocol } from 'electron';
import { APP_NAME_LOWER } from '@shared/app-identity';
import { ARTIFACT_PAGE_SCHEME } from '@main/core/artifact-pages/page-response-headers';

export const APP_SCHEME = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_NAME_LOWER}`;

/**
 * Every privileged scheme in ONE call. Electron's `registerSchemesAsPrivileged`
 * may be called only once: each call rewrites the per-privilege lists handed
 * to child processes (`--secure-schemes`, `--fetch-schemes`, …), so a second
 * call for another scheme silently strips `app://` of `secure` and the
 * renderer stops being a secure context (no `navigator.clipboard`, no
 * `crypto.randomUUID`). The artifact page scheme is `standard` so a page's
 * absolute URLs parse, and `secure` so the frame is a secure context; fetch
 * is deliberately off for it — nothing in the frame may `fetch()`
 * (`connect-src 'none'`) and the renderer never fetches page assets itself.
 * CORS is on only so the opaque-origin (CSP-sandboxed) page document can load
 * its own module scripts: a module script is a CORS load, which Chromium 156
 * (Electron 45) refuses from a scheme without CORS. The responses grant only
 * the `null` origin (`page-response-headers.ts`).
 */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        // V8 keeps compiled code for scripts served from this scheme, so a
        // later launch skips compiling the renderer bundle again. Custom
        // schemes get no code cache without it.
        codeCache: true,
      },
    },
    {
      scheme: ARTIFACT_PAGE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: false,
        corsEnabled: true,
        allowServiceWorkers: false,
      },
    },
  ]);
}

// Restrictive CSP for the packaged renderer. script-src 'self' (no
// unsafe-eval, no remote scripts) is the load-bearing directive: with ~200
// unvalidated RPC procedures behind the preload bridge, any renderer script
// execution escalates to rpc.fs.*/rpc.pty.*, so injected script must not
// run. 'unsafe-inline' styles are required by component libraries that
// inject style tags; blob: workers by Monaco. connect-src stays scheme-wide
// because cloud/WS hosts vary per environment — the protection here is
// against foreign SCRIPT, not foreign fetch targets. (The Vite dev server
// origin is not covered; its HMR needs inline scripts.) frame-src admits
// only the artifact page scheme: every page is an opaque-origin sandbox
// served by core/artifact-pages, and nothing else may be framed.
//
// A local stack serves the cloud API over plain http
// (CHORD_CLOUD_API_URL=http://localhost:1234), which `https:` does not cover:
// every cloud call from a built renderer then failed with "Failed to fetch".
// The configured API origin is admitted by name — never `http:` wholesale.
function cloudApiOrigin(): string {
  const base = process.env.CHORD_CLOUD_API_URL?.trim();
  if (!base) throw new Error('CHORD_CLOUD_API_URL is not configured');
  return new URL(base).origin;
}

function buildRendererCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' https: wss: ws: ${cloudApiOrigin()}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    `frame-src ${ARTIFACT_PAGE_SCHEME}:`,
  ].join('; ');
}

function withCspIfHtml(response: Response): Response {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', buildRendererCsp());
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function setupAppProtocol(rendererRoot: string): void {
  const root = normalize(rendererRoot);

  protocol.handle(APP_SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const relPath = decodeURIComponent(pathname).replace(/^\/+/, '');
    const resolved = normalize(join(root, relPath || 'index.html'));

    if (!resolved.startsWith(root + sep) && resolved !== root) {
      return new Response(null, { status: 403 });
    }

    try {
      return withCspIfHtml(await net.fetch(`file://${resolved}`));
    } catch {
      return withCspIfHtml(await net.fetch(`file://${join(root, 'index.html')}`));
    }
  });
}
