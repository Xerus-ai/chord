import { centerTabsEqual, type CenterTab } from './center-tab';

/** Index of `active` within `order`, or -1 if it isn't present (stale tab). */
export function indexOfActiveTab(order: readonly CenterTab[], active: CenterTab | null): number {
  if (!active) return -1;
  return order.findIndex((tab) => centerTabsEqual(tab, active));
}

/**
 * Tab to activate on "next": wraps from the last tab to the first. Falls back
 * to the first tab when `active` isn't found (e.g. it just closed).
 */
export function nextTab(
  order: readonly CenterTab[],
  active: CenterTab | null
): CenterTab | undefined {
  if (order.length === 0) return undefined;
  const index = indexOfActiveTab(order, active);
  const nextIndex = index === -1 ? 0 : (index + 1) % order.length;
  return order[nextIndex];
}

/** Tab to activate on "previous": wraps from the first tab to the last. */
export function previousTab(
  order: readonly CenterTab[],
  active: CenterTab | null
): CenterTab | undefined {
  if (order.length === 0) return undefined;
  const index = indexOfActiveTab(order, active);
  const prevIndex = index === -1 ? 0 : (index - 1 + order.length) % order.length;
  return order[prevIndex];
}

/** Tab at a 0-based strip position for `Mod+1`–`Mod+9`, or undefined past the end. */
export function tabAtIndex(order: readonly CenterTab[], index: number): CenterTab | undefined {
  return order[index];
}
