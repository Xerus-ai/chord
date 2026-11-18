/**
 * The sync server's verdict on this app's version (devstation-mg6u.2), shared by
 * main (which reads it) and the renderer (which shows it).
 *   supported        at or above the minimum, or the server names none
 *   update_required  below it: the renderer shows the update-required screen
 *   unknown          not read yet (checked: false), or the read failed
 *                    (checked: true); never blocks (offline is shown elsewhere),
 *                    and the next check tries again. The renderer holds a blank
 *                    placeholder until the first reading (devstation-mg6u.5).
 */
export type DesktopCompatibility =
  | { state: 'supported'; current: string; minimum: string | null }
  | { state: 'update_required'; current: string; minimum: string }
  | { state: 'unknown'; checked: boolean; reason: string };
