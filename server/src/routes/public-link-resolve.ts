import type { PublicLinkResolution } from '@chord/protocol';
import { Router, type Request, type Response } from 'express';
import { resolveArtifactAccess } from '../access/resolve-access.js';
import { resolvePublicLink } from '../access/resolve-public-link.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

/** One answer for a bad token, a dead link and no access: nothing is disclosed. */
function notFound(res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/**
 * A public link opened in the desktop app (shared-items step 4, decision 10).
 * The link must resolve (resolvePublicLink), and the signed-in caller must
 * reach its artifact (resolveArtifactAccess): then the app opens the artifact
 * as a tab of its work item. Everyone else gets the 404 a bad token gets, and
 * the app opens the link in the browser instead. Mounted after requireAuth at
 * /public-links/:token/resolve.
 */
export function createPublicLinkResolveRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/', async (req: Request<{ token: string }>, res) => {
    const { user } = req as unknown as AuthenticatedRequest;
    const target = await resolvePublicLink(req.params.token);
    if (!target) {
      notFound(res);
      return;
    }
    const access = await resolveArtifactAccess(user.userId, target.artifactId);
    if (access === null || access === 'not_found') {
      notFound(res);
      return;
    }
    const body: PublicLinkResolution = {
      artifact_id: target.artifactId,
      work_item_id: target.workItemId,
    };
    res.json(body);
  });

  return router;
}
