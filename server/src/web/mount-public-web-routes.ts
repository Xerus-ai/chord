import type { Express } from 'express';
import { createOpenRouter } from './open-routes.js';
import { createPublicLinkRouter } from './public-link-routes.js';

/**
 * The server's signed-out web surface (P6), mounted BEFORE requireAuth:
 * public artifact links (/p/:token) and the desktop handoff pages (/open/...).
 * Both decide access themselves — a public link through resolvePublicLink,
 * a handoff page by revealing nothing.
 */
export function mountPublicWebRoutes(app: Express): void {
  app.use('/p/:token', createPublicLinkRouter());
  app.use('/open', createOpenRouter());
}
