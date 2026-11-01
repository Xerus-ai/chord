import React, { useEffect, useRef, useState } from 'react';
import { McpView } from '@renderer/features/mcp/components/McpView';
import type { SettingsCardId } from '@renderer/features/settings/settings-card-ids';
import {
  resolveSettingsCardId,
  resolveSettingsTab,
  settingsCardDomId,
  settingsCardsForTab,
  tabForSettingsCard,
  type SettingsTabId,
} from '@renderer/features/settings/settings-cards';
import SkillsView from '@renderer/features/skills/components/SkillsView';
import { Separator } from '@renderer/lib/ui/separator';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { cn } from '@renderer/utils/utils';
import { AccountTab } from './AccountTab';
import { AgentLaunchSettingsCard } from './AgentLaunchSettingsCard';
import { ArtifactsSettingsCard, PreferredFormatSettingsCard } from './ArtifactsSettingsCards';
import BranchPrefixCard from './BranchPrefixCard';
import { CliAgentsList } from './CliAgentsList';
import DefaultAgentSettingsCard from './DefaultAgentSettingsCard';
import { DefaultPermissionModeSettingsCard } from './DefaultPermissionModeSettingsCard';
import GitAiSettingsCard from './GitAiSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import NotificationTypePreferences from './NotificationTypePreferences';
import { PublishingSettingsCard } from './PublishingSettingsCard';
import QualityGatesCard from './QualityGatesCard';
import RepositoriesCard from './RepositoriesCard';
import { ReviewPromptResetButton, ReviewPromptSettingsCard } from './ReviewPromptSettingsCard';
import { DefaultAccessSettingsCard, SharedByMeCard } from './SharingSettingsCards';
import SourceControlSettingsCard from './SourceControlSettingsCard';
import TeamPulseCard from './TeamPulseCard';
import { TeamSettingsTab } from './TeamSettingsTab';
import { TeamSharingPolicyCard } from './TeamSharingPolicyCard';
import TelemetryCard from './TelemetryCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import ThemeCard from './ThemeCard';
import { UpdateCard } from './UpdateCard';
import WorktreeRootCard from './WorktreeRootCard';
import WorktreeSourcesCard from './WorktreeSourcesCard';

/** The tab list lives with the card registry; re-exported for existing callers. */
export type SettingsPageTab = SettingsTabId;

/**
 * Every registered card's renderer. Keyed by `SettingsCardId`, so a card added
 * to the registry without a component here is a compile error rather than a
 * silently missing section.
 */
const CARD_COMPONENTS: Record<
  SettingsCardId,
  { component: React.ReactNode; action?: React.ReactNode }
> = {
  telemetry: { component: <TelemetryCard /> },
  notifications: { component: <NotificationSettingsCard /> },
  'notification-types': { component: <NotificationTypePreferences /> },
  updates: { component: <UpdateCard /> },
  account: { component: <AccountTab /> },
  'default-agent': { component: <DefaultAgentSettingsCard /> },
  'agent-launch': { component: <AgentLaunchSettingsCard /> },
  'default-permission-mode': { component: <DefaultPermissionModeSettingsCard /> },
  'review-prompt': {
    component: <ReviewPromptSettingsCard />,
    action: <ReviewPromptResetButton />,
  },
  'cli-agents': { component: <CliAgentsList /> },
  integrations: { component: <IntegrationsCard /> },
  'team-pulse': { component: <TeamPulseCard /> },
  skills: { component: <SkillsView /> },
  mcp: { component: <McpView /> },
  repositories: { component: <RepositoriesCard /> },
  'branch-prefix': { component: <BranchPrefixCard /> },
  'source-control': { component: <SourceControlSettingsCard /> },
  'git-ai': { component: <GitAiSettingsCard /> },
  'worktree-root': { component: <WorktreeRootCard /> },
  'worktree-sources': { component: <WorktreeSourcesCard /> },
  theme: { component: <ThemeCard /> },
  terminal: { component: <TerminalSettingsCard /> },
  keyboard: { component: <KeyboardSettingsCard /> },
  'hidden-tools': { component: <HiddenToolsSettingsCard /> },
  team: { component: <TeamSettingsTab /> },
  'quality-gates': { component: <QualityGatesCard /> },
  artifacts: { component: <ArtifactsSettingsCard /> },
  'preferred-format': { component: <PreferredFormatSettingsCard /> },
  publishing: { component: <PublishingSettingsCard /> },
  'default-access': { component: <DefaultAccessSettingsCard /> },
  'shared-by-me': { component: <SharedByMeCard /> },
  'team-sharing': { component: <TeamSharingPolicyCard /> },
};

const TAB_HEADINGS: Record<
  Exclude<SettingsTabId, 'docs'>,
  { title: string; description: string }
> = {
  general: {
    title: 'General',
    description: 'Your account, privacy, and app updates.',
  },
  'clis-models': {
    title: 'Agents & models',
    description: 'Manage CLI agents and model configurations.',
  },
  artifacts: {
    title: 'Artifacts',
    description: 'Choose how agents save plans, reports and prototypes for your team.',
  },
  sharing: {
    title: 'Sharing',
    description: 'Everything is private until you share it. See and manage what you have shared.',
  },
  integrations: {
    title: 'Integrations',
    description: 'Connect external services and tools.',
  },
  skills: {
    title: 'Skills',
    description: 'Extend your agents with reusable skill modules.',
  },
  mcp: {
    title: 'MCP Servers',
    description: 'Connect your agents with external data sources and tools.',
  },
  repository: {
    title: 'Repository',
    description: 'Add repositories and open the settings of each.',
  },
  git: {
    title: 'Git & worktrees',
    description:
      'How Chord names branches, shows changes, and places checkouts, for every repository.',
  },
  interface: {
    title: 'Interface',
    description: 'Customize the appearance, notifications, and behavior of the app.',
  },
  team: { title: 'Team', description: 'Manage team members and sharing defaults.' },
  rules: {
    title: 'Rules',
    description: 'Configure team guardrails, quality gates, and the review prompt.',
  },
};

export function SettingsPage({
  tab: activeTab,
  card: activeCard,
}: {
  tab: SettingsPageTab;
  /** Card to scroll to on open. Set by search and by external deep links. */
  card?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [highlightedCard, setHighlightedCard] = useState<SettingsCardId | null>(null);

  // Skills and MCP used to be standalone views with their own view-level
  // telemetry. They are settings tabs now, so the tab itself reports the view.
  useEffect(() => {
    if (activeTab === 'skills') captureTelemetry('skills_viewed', { from_view: 'settings' });
    if (activeTab === 'mcp') captureTelemetry('mcp_viewed', { from_view: 'settings' });
  }, [activeTab]);

  // A snapshot from an older build can still name a tab that has since moved,
  // so the incoming id is resolved rather than rendered as given.
  const resolvedTab = resolveSettingsTab(activeTab);
  const resolvedCard = resolveSettingsCardId(activeCard);

  // Scrolling waits a frame: the card only exists in the DOM after the tab it
  // lives on has rendered, and a search hit routinely changes both at once.
  useEffect(() => {
    if (!resolvedCard) return;
    if (tabForSettingsCard(resolvedCard) !== resolvedTab) return;

    const frame = requestAnimationFrame(() => {
      const node = contentRef.current?.querySelector(`#${settingsCardDomId(resolvedCard)}`);
      node?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setHighlightedCard(resolvedCard);
    });
    return () => cancelAnimationFrame(frame);
  }, [resolvedCard, resolvedTab]);

  // The highlight is a "here it is" cue, not state. It clears itself so the
  // ring does not persist as though the card were selected.
  useEffect(() => {
    if (!highlightedCard) return;
    const timer = setTimeout(() => setHighlightedCard(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightedCard]);
  const heading =
    resolvedTab === 'docs'
      ? undefined
      : TAB_HEADINGS[resolvedTab as Exclude<SettingsTabId, 'docs'>];
  const sections = settingsCardsForTab(resolvedTab);

  // The nav lives in the settings rail (`SettingsSidebar`), which replaced the
  // sessions sidebar; this is the content pane only.
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {heading && (
        <div
          ref={contentRef}
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-12"
        >
          <div className="mx-auto w-full max-w-3xl space-y-8 py-10">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-1">
                <h2 className="text-display tracking-display">{heading.title}</h2>
                <p className="text-body tracking-body text-text-muted">{heading.description}</p>
              </div>
              <Separator />
            </div>
            {sections.map((card) => {
              const { component, action } = CARD_COMPONENTS[card.id];
              return (
                <div
                  key={card.id}
                  id={settingsCardDomId(card.id)}
                  className={cn(
                    'flex flex-col gap-3 rounded-lg transition-shadow',
                    highlightedCard === card.id &&
                      'ring-2 ring-selected-border ring-offset-2 ring-offset-surface'
                  )}
                >
                  {card.title && (
                    <div className="flex items-center justify-between">
                      <h3 className="text-title tracking-title font-normal text-text">
                        {card.title}
                      </h3>
                      {action && <div>{action}</div>}
                    </div>
                  )}
                  {/* One band per section (devstation-dkqo): the body sits in
                          a raised, hairline-bordered container so every tab reads
                          as the same contract. Rows inside pad themselves. */}
                  {card.unbanded ? (
                    component
                  ) : (
                    <div className="rounded-lg border border-border-subtle bg-surface-raised px-5 py-1">
                      {component}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
