import {
  CHORD_VERSION_HEADER,
  CHORD_VERSION_PARAM,
  isClientVersionAccepted,
  MIN_DESKTOP_VERSION,
  REFUSAL_UPDATE_REQUIRED,
} from '@chord/protocol';
import type { NextFunction, Request, Response } from 'express';

/**
 * The server half of the minimum desktop version (devstation-mg6u.13). /health
 * only asks an old app to stop; these refuse it. A client that names no
 * version is refused like one below the minimum: every Chord client names it.
 */

/** Express middleware for the signed-in API: mounted before requireAuth, so no token work is done for a refused client. */
export function requireClientVersion(req: Request, res: Response, next: NextFunction): void {
  if (isClientVersionAccepted(req.get(CHORD_VERSION_HEADER), MIN_DESKTOP_VERSION)) {
    next();
    return;
  }
  res
    .status(426)
    .json({ error: REFUSAL_UPDATE_REQUIRED, min_desktop_version: MIN_DESKTOP_VERSION });
}

/** Whether a socket upgrade's URL names an accepted client version. */
export function isUpgradeVersionAccepted(params: URLSearchParams): boolean {
  return isClientVersionAccepted(params.get(CHORD_VERSION_PARAM), MIN_DESKTOP_VERSION);
}

/** Thrown from Hocuspocus onAuthenticate: its `reason` reaches the client as the refusal reason. */
export function updateRequiredRefusal(): Error & { reason: string } {
  return Object.assign(new Error(REFUSAL_UPDATE_REQUIRED), { reason: REFUSAL_UPDATE_REQUIRED });
}
