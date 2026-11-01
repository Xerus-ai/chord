import express, { type Express } from 'express';

/**
 * Every JSON body parser, in the one order that works. Mounted by server.ts
 * and by the real-DB route tests, so a raised limit is exercised through the
 * production wiring.
 *
 * Path-scoped raised limits MUST mount before the global parser: express
 * parses with the first matching json() and body-parser skips already-parsed
 * bodies, so a limit raised after the global mount would never apply. Bulk
 * history pushes carry up to ~256KB chunks plus overhead; git-state pushes
 * carry up to the 800KB snapshot budget plus JSON escaping. Version uploads
 * carry the page source plus its view (capped at 8 MiB by the versions route,
 * which answers 413 itself above that) — or a file's bytes as base64 (8 MiB
 * raw is ~10.7 MB) plus, for a docx or image, its view.
 */
export function mountJsonBodyParsers(app: Express): void {
  app.use('/work-items/:work_item_id/messages/bulk', express.json({ limit: '2mb' }));
  app.use('/work-items/:work_item_id/git-state', express.json({ limit: '2mb' }));
  app.use(
    '/work-items/:work_item_id/artifacts/:artifact_id/versions',
    express.json({ limit: '20mb' })
  );
  app.use(express.json());
}
