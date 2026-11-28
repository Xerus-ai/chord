import { CARD_FALLBACK_LABELS } from '@renderer/features/settings/settings-card-ids';
import {
  SETTINGS_CARDS,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  type SettingsCardMeta,
  type SettingsGroupId,
  type SettingsTabId,
} from '@renderer/features/settings/settings-cards';

/**
 * Settings search over the card registry (`settings-cards.ts`): each card's label, where it
 * lives, and a ranked match of a query against titles, keywords and tab labels.
 */

const TAB_LABELS: ReadonlyMap<SettingsTabId, string> = new Map(
  SETTINGS_TABS.map((tab) => [tab.id, tab.label])
);

const GROUP_LABELS: ReadonlyMap<SettingsGroupId, string> = new Map(
  SETTINGS_GROUPS.map((group) => [group.id, group.label])
);

export interface SettingsSearchHit {
  card: SettingsCardMeta;
  /** "Group › Tab", for showing where a hit lives without opening it. */
  breadcrumb: string;
  /** What the query matched, so the UI can show why a hit is a hit. */
  label: string;
}

export function settingsCardLabel(card: SettingsCardMeta): string {
  return card.title ?? CARD_FALLBACK_LABELS[card.id];
}

export function settingsCardBreadcrumb(card: SettingsCardMeta): string {
  const tab = SETTINGS_TABS.find((entry) => entry.id === card.tab);
  const group = tab ? GROUP_LABELS.get(tab.group) : undefined;
  const tabLabel = TAB_LABELS.get(card.tab) ?? card.tab;
  return group ? `${group} › ${tabLabel}` : tabLabel;
}

/**
 * Ranked card search over titles, tab labels and keywords.
 *
 * Ranking is deliberately coarse — a title match beats a keyword match beats a
 * tab-label match — because the corpus is twenty cards. Anything cleverer would
 * be tuning against a set small enough to read.
 */
export function searchSettingsCards(query: string): SettingsSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const scored: Array<{ hit: SettingsSearchHit; score: number }> = [];

  for (const card of SETTINGS_CARDS) {
    const label = settingsCardLabel(card);
    const tabLabel = TAB_LABELS.get(card.tab) ?? '';

    let score = 0;
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.startsWith(needle)) score = 100;
    else if (lowerLabel.includes(needle)) score = 80;
    else if (card.keywords.some((keyword) => keyword.startsWith(needle))) score = 60;
    else if (card.keywords.some((keyword) => keyword.includes(needle))) score = 40;
    else if (tabLabel.toLowerCase().includes(needle)) score = 20;

    if (score > 0) {
      scored.push({
        hit: { card, breadcrumb: settingsCardBreadcrumb(card), label },
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label))
    .map((entry) => entry.hit);
}
