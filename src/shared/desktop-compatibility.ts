/**
 * The sync server's verdict on this app's version (devstation-mg6u.2), shared by
 * main (which reads it) and the renderer (which shows it).
 *   supported        at or above the minimum, or the server names none
 *   update_required  below it: the renderer shows the update-required screen
 *   unknown          not read yet, or never read; never blocks (offline is shown
 *                    elsewhere), and the next check tries again
 */
export type DesktopCompatibility =
  | { state: 'supported'; current: string; minimum: string | null }
  | { state: 'update_required'; current: string; minimum: string }
  | { state: 'unknown'; reason: string };
