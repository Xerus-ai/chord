import { describe, expect, it } from 'vitest';
import {
  resolveSettingsCardId,
  resolveSettingsTab,
  searchSettingsCards,
  SETTINGS_CARDS,
  SETTINGS_GROUPS,
  SETTINGS_TABS,
  settingsCardBreadcrumb,
  settingsCardDomId,
  settingsCardLabel,
  settingsCardsForTab,
  tabForSettingsCard,
} from '@renderer/features/settings/settings-cards';

/**
 * The component map in `SettingsPage` is keyed by `SettingsCardId`, so
 * "every card renders" and "every rendered card is registered" are both
 * compile-time facts. These cover what the type system cannot see.
 */
describe('settings card registry', () => {
  it('has no duplicate card ids', () => {
    const ids = SETTINGS_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every navigable tab at least one card', () => {
    // Driven off the tab list itself, so a tab added to the sidebar without
    // cards fails here instead of rendering an empty pane. 'docs' is an
    // external link rather than a tab, so it is absent from SETTINGS_TABS.
    for (const tab of SETTINGS_TABS) {
      expect(settingsCardsForTab(tab.id).length, `tab '${tab.id}' has no cards`).toBeGreaterThan(0);
    }
  });

  it('places every tab in a declared group', () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((group) => group.id));
    for (const tab of SETTINGS_TABS) {
      expect(groupIds.has(tab.group), `tab '${tab.id}' has an unknown group`).toBe(true);
    }
  });

  it('leaves no group empty', () => {
    for (const group of SETTINGS_GROUPS) {
      const tabs = SETTINGS_TABS.filter((tab) => tab.group === group.id);
      expect(tabs.length, `group '${group.id}' has no tabs`).toBeGreaterThan(0);
    }
  });

  it('assigns no cards to the external docs tab', () => {
    expect(settingsCardsForTab('docs')).toHaveLength(0);
  });

  it('resolves a retired tab from an older snapshot onto a live one', () => {
    // 'account' shipped as its own tab and its cards now live in General. A
    // persisted pointer to it must land somewhere real, not on a blank pane.
    expect(resolveSettingsTab('account')).toBe('general');
    expect(settingsCardsForTab(resolveSettingsTab('account')).map((c) => c.id)).toContain(
      'account'
    );
  });

  it('falls back to General for unknown or missing tab ids', () => {
    expect(resolveSettingsTab(undefined)).toBe('general');
    expect(resolveSettingsTab('not-a-tab')).toBe('general');
  });

  it('passes through live tab ids untouched', () => {
    for (const tab of SETTINGS_TABS) {
      expect(resolveSettingsTab(tab.id)).toBe(tab.id);
    }
    expect(resolveSettingsTab('docs')).toBe('docs');
  });

  it('keeps the guardrail cards together under Rules', () => {
    const ruleCards = settingsCardsForTab('rules').map((card) => card.id);
    expect(ruleCards).toContain('quality-gates');
    expect(ruleCards).toContain('review-prompt');
  });

  it('gives every card search keywords', () => {
    for (const card of SETTINGS_CARDS) {
      expect(card.keywords.length, `card '${card.id}' has no keywords`).toBeGreaterThan(0);
      for (const keyword of card.keywords) {
        expect(keyword).toBe(keyword.trim().toLowerCase());
      }
    }
  });

  it('routes the OpenRouter billing vocabulary to Team Pulse', () => {
    // The question that started this: a user looking for where the key goes
    // searches for the provider or for what it costs them, not for "pulse".
    const teamPulse = SETTINGS_CARDS.find((card) => card.id === 'team-pulse');
    expect(teamPulse).toBeDefined();
    for (const term of ['openrouter', 'api key', 'billing']) {
      expect(teamPulse?.keywords).toContain(term);
    }
  });

  it('gives every card a non-empty label', () => {
    for (const card of SETTINGS_CARDS) {
      expect(settingsCardLabel(card).length, `card '${card.id}' has no label`).toBeGreaterThan(0);
    }
  });
});

describe('settings search', () => {
  it('returns nothing for an empty query', () => {
    expect(searchSettingsCards('')).toHaveLength(0);
    expect(searchSettingsCards('   ')).toHaveLength(0);
  });

  it('finds Team Pulse from the billing vocabulary, not just the feature name', () => {
    // The original question was "where do I put the key / who pays" — none of
    // which contains the word this card is titled with.
    for (const query of ['openrouter', 'api key', 'billing', 'cost']) {
      const ids = searchSettingsCards(query).map((hit) => hit.card.id);
      expect(ids, `query '${query}' missed team-pulse`).toContain('team-pulse');
    }
  });

  it('ranks a title match above a keyword-only match', () => {
    const hits = searchSettingsCards('theme');
    expect(hits[0]?.card.id).toBe('theme');
  });

  it('is case and whitespace insensitive', () => {
    expect(searchSettingsCards('  OpenRouter ').map((h) => h.card.id)).toContain('team-pulse');
  });

  it('reports where each hit lives', () => {
    const hit = searchSettingsCards('openrouter')[0];
    expect(hit?.breadcrumb).toBe('Connections › Integrations');
  });

  // devstation-0nu: the + menu's "Agent settings…" row leads here.
  it('finds Open agents in from the terminal and chat vocabulary', () => {
    for (const query of ['terminal', 'open agents in', 'cli']) {
      const hit = searchSettingsCards(query).find((h) => h.card.id === 'agent-launch');
      expect(hit, `query '${query}' missed agent-launch`).toBeDefined();
      expect(hit?.breadcrumb).toBe('Agents › Agents & models');
    }
  });

  it('returns nothing for a query that matches no card', () => {
    expect(searchSettingsCards('zzzznotasetting')).toHaveLength(0);
  });

  it('gives every card a breadcrumb naming a real group and tab', () => {
    for (const card of SETTINGS_CARDS) {
      expect(settingsCardBreadcrumb(card)).toContain('›');
    }
  });
});

describe('settings card anchors', () => {
  it('accepts known card ids and rejects everything else', () => {
    expect(resolveSettingsCardId('team-pulse')).toBe('team-pulse');
    expect(resolveSettingsCardId('not-a-card')).toBeUndefined();
    expect(resolveSettingsCardId(undefined)).toBeUndefined();
  });

  it('routes every card anchor to the tab that renders it', () => {
    for (const card of SETTINGS_CARDS) {
      const tab = tabForSettingsCard(card.id);
      expect(settingsCardsForTab(tab).map((entry) => entry.id)).toContain(card.id);
    }
  });

  it('sends the Team Pulse anchor to Integrations', () => {
    expect(tabForSettingsCard('team-pulse')).toBe('integrations');
  });

  it('builds DOM ids that are valid CSS selectors', () => {
    for (const card of SETTINGS_CARDS) {
      expect(settingsCardDomId(card.id)).toMatch(/^settings-card-[a-z0-9-]+$/);
    }
  });
});

describe('settings card placement (settings redesign, devstation-tuz6)', () => {
  it('keeps the worktree cards together on the Git & worktrees tab, not General', () => {
    expect(tabForSettingsCard('worktree-root')).toBe('git');
    expect(tabForSettingsCard('worktree-sources')).toBe('git');
    const general = settingsCardsForTab('general').map((card) => card.id);
    expect(general).not.toContain('worktree-root');
    expect(general).not.toContain('worktree-sources');
  });

  it('leaves General with account, privacy and updates only', () => {
    expect(settingsCardsForTab('general').map((card) => card.id)).toEqual([
      'account',
      'telemetry',
      'updates',
    ]);
  });

  it('labels the git tab for both branches and worktrees', () => {
    expect(SETTINGS_TABS.find((tab) => tab.id === 'git')?.label).toBe('Git & worktrees');
  });
});
