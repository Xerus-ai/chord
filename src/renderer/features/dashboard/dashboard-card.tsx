import {
  Check,
  Circle,
  FileText,
  GitBranch,
  GitPullRequest,
  Globe,
  Play,
  Target,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DashboardLinks } from '@shared/dashboard-links';
import type { IssueProviderType } from '@shared/issue-providers';
import type { RepoIcon } from '@shared/repo-icons';
import { RepoIdentityTile } from '@renderer/features/app-sidebar/repo-identity-tile';
import { getGitGlyph } from '@renderer/features/app-sidebar/row-presentation';
import type { SidebarItem } from '@renderer/features/app-sidebar/sidebar-projection';
import { ISSUE_PROVIDER_META } from '@renderer/features/integrations/issue-provider-meta';
import { AvatarStack, type AvatarStackMember } from '@renderer/lib/components/chrome/avatar-stack';
import { GLYPH_ICON } from '@renderer/lib/components/git-glyph';
import { ProviderTile } from '@renderer/lib/components/provider-tile';
import { rpc } from '@renderer/lib/ipc';
import { statusTextClass, type StatusSignal } from '@renderer/lib/status-dot';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { findAgentInfo } from '@renderer/utils/agentConfig';
import { cn } from '@renderer/utils/utils';
import { chooseCardSignal } from './dashboard-projection';

/** Tint is status, so it only ever comes from the status family — the same
 * `/15` wash the sidebar's reauth badge uses. Neutral is outlined, not filled. */
const CHIP_CLASS: Record<StatusSignal, string> = {
  warning: 'bg-status-warn/15 text-status-warn',
  danger: 'bg-status-err-bg text-status-err',
  running: 'bg-status-running/15 text-status-running',
  success: 'bg-status-ok-bg text-status-ok',
  merged: 'bg-status-merged/15 text-status-merged',
  neutral: 'border border-border text-text-muted',
};

function SignalChip({ item }: { item: SidebarItem }) {
  const signal = chooseCardSignal(item);
  if (!signal) return null;
  return (
    <span
      className={cn(
        'flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-tiny tracking-tiny font-medium',
        CHIP_CLASS[signal.signal]
      )}
    >
      {signal.signal === 'running' && (
        <span className="size-1.5 animate-pulse rounded-full bg-status-running" />
      )}
      {signal.label}
    </span>
  );
}

/** One entry on the facts line. Entries are spaced, not dot-separated: in
 * a narrow card the line wraps, and a separator would then lead a line. Each
 * entry carries its own icon, which is what tells them apart. */
function Fact({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">{children}</span>;
}

/** `ticket_provider` is free text in SQLite; only a known provider gets a logo. */
function issueProviderMeta(provider: string) {
  return Object.hasOwn(ISSUE_PROVIDER_META, provider)
    ? ISSUE_PROVIDER_META[provider as IssueProviderType]
    : null;
}

function TicketFact({ tickets }: { tickets: DashboardLinks['tickets'] }) {
  const [first, ...rest] = tickets;
  if (!first) return null;
  const meta = issueProviderMeta(first.ticketProvider);
  return (
    <Fact>
      {meta ? (
        <img src={meta.logo} alt={meta.displayName} className="size-icon-xs rounded-sm" />
      ) : (
        <Target className="size-icon-xs" />
      )}
      <span className="font-mono text-text-muted">{first.ticketId}</span>
      {rest.length > 0 && <span>+{rest.length}</span>}
    </Fact>
  );
}

/** The count on the card; the names only on hover, where there is room for them. */
function ArtifactFact({ artifacts }: { artifacts: DashboardLinks['artifacts'] }) {
  if (artifacts.length === 0) return null;
  return (
    <Fact>
      <span className="group/artifacts relative flex items-center gap-1">
        <FileText className="size-icon-xs" />
        {artifacts.length}
        <span className="absolute top-full left-0 z-10 mt-1.5 hidden min-w-56 flex-col rounded-lg border border-border-strong bg-surface-raised p-1 shadow-lg group-hover/artifacts:flex">
          {artifacts.map((artifact) => (
            <span
              key={artifact.id}
              className="flex h-7 items-center gap-2 rounded-md px-1.5 text-text-muted"
            >
              <FileText className="size-icon-xs shrink-0 text-text-passive" />
              <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
              <span className="pl-3 text-text-passive">{artifact.status.replaceAll('_', ' ')}</span>
            </span>
          ))}
        </span>
      </span>
    </Fact>
  );
}

function ChecksGlyph({ checks }: { checks: 'passing' | 'failing' | 'pending' | null }) {
  if (checks === 'passing') return <Check className="size-icon-xs text-status-ok" />;
  if (checks === 'failing') return <X className="size-icon-xs text-status-err" />;
  if (checks === 'pending') return <Circle className="size-2.5 text-status-warn" />;
  return null;
}

function CardFacts({
  item,
  links,
  providerId,
  branch,
  repoIcon,
}: {
  item: SidebarItem;
  links: DashboardLinks | undefined;
  providerId: string | null;
  branch: string | null;
  repoIcon: RepoIcon | null;
}) {
  const agent = findAgentInfo(providerId);
  const pr = item.pullRequest;
  const diff = item.diffStats;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-tiny tracking-tiny text-text-passive">
      {/* The dashboard is not grouped by repo the way the sidebar is, so the
          card has to say which repo it belongs to. */}
      <Fact>
        <RepoIdentityTile repoId={item.repoId} label={item.repoLabel} icon={repoIcon} />
        <span className="text-text-muted">{item.repoLabel}</span>
      </Fact>
      {agent && (
        <Fact>
          <ProviderTile providerId={providerId} />
          {agent.name}
        </Fact>
      )}
      {branch && (
        <Fact>
          <GitBranch className="size-icon-xs" />
          {/* The longest fact, so the first to give way in a narrow card. */}
          <span className="max-w-48 truncate font-mono text-text-muted" title={branch}>
            {branch}
          </span>
        </Fact>
      )}
      {links && <TicketFact tickets={links.tickets} />}
      {pr && (
        <Fact>
          <GitPullRequest className="size-icon-xs" />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void rpc.app.openExternal(pr.url);
            }}
            className="font-mono text-text-muted hover:text-text hover:underline"
          >
            #{pr.number}
          </button>
          <ChecksGlyph checks={pr.checks} />
        </Fact>
      )}
      {links && <ArtifactFact artifacts={links.artifacts} />}
      {item.devServerUrl && (
        <Fact>
          <Globe className="size-icon-xs" />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void rpc.app.openExternal(item.devServerUrl as string);
            }}
            className="font-mono text-text-muted hover:text-text hover:underline"
          >
            {item.devServerUrl.replace(/^https?:\/\//, '')}
          </button>
        </Fact>
      )}
      {diff && diff.added + diff.removed > 0 && (
        <Fact>
          <span className="font-mono tabular-nums">
            <span className="text-diff-add">+{diff.added}</span>{' '}
            <span className="text-diff-del">-{diff.removed}</span>
          </span>
        </Fact>
      )}
    </div>
  );
}

export interface DashboardCardProps {
  item: SidebarItem;
  description: string | null;
  /** Undefined while loading or after a failed read — the facts are then
   * omitted, never shown as "none". */
  links: DashboardLinks | undefined;
  /** Resolved by `resolveCardProviderId` / `resolveCardBranch`. */
  providerId: string | null;
  branch: string | null;
  repoIcon: RepoIcon | null;
  sharedWith: AvatarStackMember[];
  /** Epoch seconds: the newest finished turn, else the row's last update. */
  lastActiveAt: number;
  /** The newest live session, when there is one to go back to. */
  resumeSessionId: string | null;
  onOpen: () => void;
  onResume: (sessionId: string) => void;
}

/**
 * A work item on the dashboard, in three tiers: what it is and whether it
 * wants you; what it is about; and the facts it is made of. Hover (or focus)
 * trades the time for the one action the card offers.
 */
export function DashboardCard({
  item,
  description,
  links,
  providerId,
  branch,
  repoIcon,
  sharedWith,
  lastActiveAt,
  resumeSessionId,
  onOpen,
  onResume,
}: DashboardCardProps) {
  const { glyph, signal } = getGitGlyph(item);
  const Glyph = GLYPH_ICON[glyph];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        // Only the card's own focus opens it. A key on Resume or a PR link
        // bubbles here too, and preventDefault would cancel that button's
        // own activation and open the item instead.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group/card flex h-full cursor-pointer gap-2.5 rounded-lg border border-border bg-surface-raised px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-surface-hover focus-visible:border-border-strong focus-visible:outline-none"
    >
      <Glyph
        className={cn('mt-0.5 size-icon-sm shrink-0', statusTextClass(signal))}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body tracking-body font-medium text-text">
            {item.name}
          </span>
          <SignalChip item={item} />
          {sharedWith.length > 0 && <AvatarStack members={sharedWith} />}
          <span className="shrink-0 text-tiny tracking-tiny tabular-nums text-text-passive">
            <RelativeTime value={lastActiveAt * 1000} compact />
          </span>
          {/* Always there as an icon so every card shows its way back in;
              the card's hover names it and lifts it to the primary action. */}
          <button
            type="button"
            title={resumeSessionId ? 'Resume the live session' : 'Open work item'}
            onClick={(event) => {
              event.stopPropagation();
              if (resumeSessionId) onResume(resumeSessionId);
              else onOpen();
            }}
            className="-my-0.5 flex h-6 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-tiny tracking-tiny font-medium text-text-passive transition-colors group-hover/card:bg-action-bg group-hover/card:px-2.5 group-hover/card:text-action-fg group-focus-visible/card:bg-action-bg group-focus-visible/card:text-action-fg hover:bg-action-bg-hover"
          >
            <Play className="size-3 fill-current" />
            <span className="hidden group-hover/card:inline group-focus-visible/card:inline">
              {resumeSessionId ? 'Resume' : 'Open'}
            </span>
          </button>
        </div>
        {description && (
          <p className="mt-0.5 truncate text-tiny tracking-tiny text-text-passive">{description}</p>
        )}
        <CardFacts
          item={item}
          links={links}
          providerId={providerId}
          branch={branch}
          repoIcon={repoIcon}
        />
      </div>
    </div>
  );
}
