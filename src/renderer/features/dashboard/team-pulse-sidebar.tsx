import { Github, Loader2, RefreshCw, Search, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineNotice } from '@renderer/features/dashboard/dashboard-sections';
import { InviteSection } from '@renderer/features/dashboard/invite-section';
import { ActivityRow, PulseCard } from '@renderer/features/dashboard/pulse-cards';
import {
  AiDisabledState,
  EmptyPulseState,
  GenerateStatusMessage,
  QuickLink,
  StaleIndicator,
  type GenerateStatus,
} from '@renderer/features/dashboard/pulse-states';
import {
  cloudTeamApi,
  type TeamActivity,
  type TeamPulseSummary,
} from '@renderer/lib/cloud-team-api';
import { describeLoadError } from '@renderer/lib/components/load-error-notice';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';

/** 'unknown' = the team feed failed to load, so teammate presence is undetermined. */
export type TeamPresenceStatus = 'has-team' | 'no-team' | 'unknown';

interface TeamPulseSidebarProps {
  orgId: string | null;
  githubConnected?: boolean;
  onTeamStatus?: (status: TeamPresenceStatus) => void;
  onAction?: (key: string) => void;
}

const AUTO_REFRESH_MS = 60_000;

type PulseTab = 'summaries' | 'activity';

export function TeamPulseSidebar({
  orgId,
  githubConnected,
  onTeamStatus,
  onAction,
}: TeamPulseSidebarProps) {
  const [summaries, setSummaries] = useState<TeamPulseSummary[]>([]);
  const [activity, setActivity] = useState<TeamActivity[]>([]);
  const [activeTab, setActiveTab] = useState<PulseTab>('summaries');
  const [initialLoadDone, setInitialLoadDone] = useState(!orgId);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [aiCheckError, setAiCheckError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const inviteEl = useRef<HTMLInputElement | null>(null);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    try {
      const [pulseData, activityData] = await Promise.all([
        cloudTeamApi.getTeamPulse(orgId),
        cloudTeamApi.getTeamActivity(orgId),
      ]);
      setSummaries(pulseData);
      setActivity(activityData);
      setFetchError(null);
    } catch (error) {
      setFetchError(describeLoadError(error));
    } finally {
      setInitialLoadDone(true);
    }
  }, [orgId]);

  useEffect(() => {
    void fetchData();
    intervalRef.current = setInterval(() => void fetchData(), AUTO_REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  const checkAiConnection = useCallback(async () => {
    try {
      const result = await rpc.openRouter.checkConnection();
      setAiConnected(result.connected);
      setAiCheckError(null);
    } catch (error) {
      setAiCheckError(describeLoadError(error));
    }
  }, []);

  useEffect(() => {
    void checkAiConnection();
  }, [checkAiConnection]);

  useEffect(() => {
    if (!initialLoadDone) return;
    const hasTeammates = summaries.length > 0 || activity.length > 0;
    if (fetchError && !hasTeammates) {
      onTeamStatus?.('unknown');
      return;
    }
    onTeamStatus?.(hasTeammates ? 'has-team' : 'no-team');
  }, [initialLoadDone, summaries.length, activity.length, fetchError, onTeamStatus]);

  const handleGenerate = useCallback(async () => {
    if (generating) return;
    if (!orgId) {
      setGenerateStatus({
        tone: 'error',
        message: 'Join a Chord organization to generate team summaries.',
      });
      return;
    }
    setGenerating(true);
    setGenerateStatus(null);
    try {
      const cloudApiBase = (import.meta as ImportMeta & { env: Record<string, string> }).env
        .VITE_CLOUD_API_URL;
      const result = await rpc.openRouter.generateTeamPulse({ orgId, cloudApiBase });
      if (!result.success) {
        setGenerateStatus({ tone: 'error', message: result.error ?? 'Failed to generate pulse.' });
        return;
      }
      if (result.count === 0) {
        setGenerateStatus({ tone: 'info', message: 'No teammate activity to summarize yet.' });
      }
      await fetchData();
    } catch (error) {
      setGenerateStatus({ tone: 'error', message: describeLoadError(error) });
    } finally {
      setGenerating(false);
    }
  }, [orgId, generating, fetchData]);

  const handleInviteClick = useCallback(() => {
    // The invite input only exists in the empty/setup branches — once the team
    // has activity there is nothing to focus, so fall back to Team settings.
    const el = inviteEl.current;
    if (el) {
      el.focus();
      return;
    }
    onAction?.('invite');
  }, [onAction]);

  const captureInviteEl = useCallback((el: HTMLInputElement | null) => {
    inviteEl.current = el;
  }, []);

  const hasContent = initialLoadDone && (summaries.length > 0 || activity.length > 0);
  // Summaries and activity describe the same teammates; the larger list is
  // the one that has heard from everyone.
  const teammateCount = Math.max(summaries.length, activity.length);
  const showSetupState = initialLoadDone && !hasContent;
  // EmptyPulseState renders the generate status itself — don't print it twice.
  const tabShowsEmptyPulse = activeTab === 'summaries' && summaries.length === 0 && !!aiConnected;

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      {hasContent ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-border px-2">
            {(['summaries', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'h-[26px] rounded-md px-2.5 text-tiny tracking-tiny font-medium transition-colors',
                  activeTab === tab
                    ? 'bg-surface-active text-text'
                    : 'text-text-passive hover:bg-surface-hover hover:text-text-muted'
                )}
              >
                {tab === 'summaries' ? 'Summaries' : 'Activity'}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-1">
              {fetchError && (
                <StaleIndicator message={fetchError} onRetry={() => void fetchData()} />
              )}
              {aiConnected && (
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={generating}
                  title="Regenerate summaries"
                  className="flex size-6 items-center justify-center rounded-md text-text-passive transition-colors hover:bg-surface-active hover:text-text disabled:text-text-disabled"
                >
                  {generating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
          <div className="flex h-6 items-center gap-1.5 px-4 pt-3">
            <span className="section-header">Team</span>
            <span className="section-header tabular-nums font-medium">{teammateCount}</span>
            <button
              type="button"
              onClick={handleInviteClick}
              className="section-header ml-auto normal-case tracking-normal font-medium hover:text-text"
            >
              Invite
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto pt-1">
            {generateStatus && !tabShowsEmptyPulse && (
              <div className="px-4 pt-3">
                <GenerateStatusMessage status={generateStatus} />
              </div>
            )}
            {activeTab === 'summaries' ? (
              summaries.length > 0 ? (
                <div className="flex flex-col p-2">
                  {summaries.map((summary) => (
                    <PulseCard key={summary.id} summary={summary} />
                  ))}
                </div>
              ) : aiConnected ? (
                <EmptyPulseState
                  generating={generating}
                  onGenerate={handleGenerate}
                  status={generateStatus}
                />
              ) : (
                <AiDisabledState onAction={onAction} />
              )
            ) : (
              <div className="flex flex-col p-2">
                {activity.map((member) => (
                  <ActivityRow key={member.user_id} member={member} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : fetchError ? (
        <div className="p-4">
          <h3 className="mb-2 section-header">Team</h3>
          <InlineNotice
            title="Couldn't reach the team service"
            message={fetchError}
            onRetry={() => void fetchData()}
          />
        </div>
      ) : aiCheckError ? (
        <div className="p-4">
          <h3 className="mb-2 section-header">Team</h3>
          <InlineNotice
            title="Couldn't check the AI connection"
            message={aiCheckError}
            onRetry={() => void checkAiConnection()}
          />
        </div>
      ) : showSetupState ? (
        aiConnected === false ? (
          <AiDisabledState onAction={onAction} />
        ) : aiConnected ? (
          <EmptyPulseState
            generating={generating}
            onGenerate={handleGenerate}
            status={generateStatus}
          />
        ) : (
          <InviteSection orgId={orgId} onMount={captureInviteEl} />
        )
      ) : (
        <InviteSection orgId={orgId} onMount={captureInviteEl} />
      )}

      <div className="border-t border-border p-4">
        <h3 className="mb-2 section-header">Quick actions</h3>
        <div className="flex flex-col gap-0.5">
          {!githubConnected && (
            <QuickLink
              icon={Github}
              label="Connect GitHub"
              onClick={() => onAction?.('connect-github')}
            />
          )}
          <QuickLink icon={UserPlus} label="Invite teammate" onClick={handleInviteClick} />
          <QuickLink
            icon={Search}
            label="Explore skills"
            onClick={() => onAction?.('explore-skills')}
          />
        </div>
      </div>
    </div>
  );
}
