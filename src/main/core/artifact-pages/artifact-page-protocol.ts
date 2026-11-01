import { protocol } from 'electron';
import { log } from '@main/lib/logger';
import { ARTIFACT_PAGE_SCHEME, artifactPageError } from './page-response-headers';
import { handleArtifactPageRequest } from './serve-page-request';

/**
 * The scheme itself is registered as privileged in app/protocol.ts, in the
 * single `registerSchemesAsPrivileged` call shared with `app://`.
 * `runtimeDir` is `out/artifact-runtime`, built by scripts/artifact-runtime.
 */
export function setupArtifactPageProtocol(runtimeDir: string): void {
  protocol.handle(ARTIFACT_PAGE_SCHEME, async (request) => {
    try {
      return await handleArtifactPageRequest(request, runtimeDir);
    } catch (error) {
      log.error('artifact-pages: request failed', { url: request.url, error: String(error) });
      return artifactPageError(500, 'Page request failed');
    }
  });
}
