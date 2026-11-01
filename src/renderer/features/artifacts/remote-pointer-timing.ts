/** A remote collaborator's pointer fades before it disappears entirely. */
export const FADE_AFTER_MS = 3000;
export const EXPIRE_AFTER_MS = 5000;

export interface PointerAge {
  lastMoved: number;
}

/**
 * The next moment a pointer's rendering changes on its own — either crossing
 * into the faded state or expiring — or null when nothing is pending.
 *
 * Pointer positions only ever change on an awareness update, so this is the one
 * thing that needs a timer. Waking exactly at the next deadline replaces the
 * fixed one-second poll that ran for the lifetime of every open artifact, even
 * with nobody else in the document.
 */
export function nextPointerDeadline(pointers: PointerAge[], now: number): number | null {
  let earliest: number | null = null;
  for (const pointer of pointers) {
    for (const deadline of [
      pointer.lastMoved + FADE_AFTER_MS,
      pointer.lastMoved + EXPIRE_AFTER_MS,
    ]) {
      if (deadline <= now) continue;
      if (earliest === null || deadline < earliest) earliest = deadline;
    }
  }
  return earliest;
}

export function isExpired(pointer: PointerAge, now: number): boolean {
  return now - pointer.lastMoved > EXPIRE_AFTER_MS;
}

export function opacityFor(pointer: PointerAge, now: number): number {
  return now - pointer.lastMoved > FADE_AFTER_MS ? 0.3 : 1;
}
