import { Router, type Request } from 'express';
import { escapeHtml, GENERIC_CARD, renderShell, sendHtml } from './html.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Team links: `https://<server>/open/work-item/<id>` and `/open/artifact/<id>`
 * hand off to the desktop app (`chord://open/...`, routed in
 * src/main/index.ts), which opens the resource if the signed-in user has
 * access. The page is the same for every id and says nothing about what the
 * link points at — access is decided in the app, never here — so these links
 * unfurl as the generic Chord card. Replaces the dead `/join` link.
 */
export function createOpenRouter(): Router {
  const router = Router();

  router.get('/:kind/:id', (req: Request<{ kind: string; id: string }>, res) => {
    const { kind, id } = req.params;
    if ((kind !== 'work-item' && kind !== 'artifact') || !UUID.test(id)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const deepLink = `chord://open/${kind}/${id}`;
    sendHtml(
      res,
      200,
      renderShell({
        title: 'Open in Chord',
        card: GENERIC_CARD,
        header: '<span class="name">Chord</span>',
        body: `<p>Opening this ${kind === 'artifact' ? 'artifact' : 'work item'} in Chord…</p>
      <p><a href="${escapeHtml(deepLink)}">Open in Chord</a></p>
      <p class="note">Nothing happened? This link opens in the Chord desktop app, for people it has been shared with.</p>`,
        redirectTo: deepLink,
      })
    );
  });

  return router;
}
