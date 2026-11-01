import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import type { DetectedAgent } from '@shared/skills/types';
import { IntegrationsProvider } from '@renderer/features/integrations/integrations-provider';
import { ChordMark } from '@renderer/lib/components/chord-mark';
import { rpc } from '@renderer/lib/ipc';
import { ModalProvider } from '@renderer/lib/modal/modal-provider';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { dependenciesStore } from '@renderer/lib/stores/app-state';
import { useResourceData } from '@renderer/lib/stores/use-resource';
import { Button } from '@renderer/lib/ui/button';
import { useAppSettingsKey } from '../settings/use-app-settings-key';
import { OnboardingAccountsSection } from './onboarding-accounts';
import { OnboardingAgentSection } from './onboarding-agent-grid';
import { OnboardingInviteSection } from './onboarding-invite';
import { OnboardingRepoSection } from './onboarding-repo-section';
import { summarizeProgress } from './onboarding-state';
import { OnboardingWorkspaceSection } from './onboarding-workspace';

const DETECTABLE_AGENTS = AGENT_PROVIDERS.filter(
  (p) => p.detectable !== false && p.commands?.length
);

/**
 * Onboarding runs before `AppContent` mounts, so the providers the connect
 * rows need do not exist yet: it brings its own IntegrationsProvider and modal
 * host rather than duplicating the integration forms.
 */
export function OnboardingView({ onComplete }: { onComplete: () => void }) {
  return (
    <IntegrationsProvider>
      <ModalProvider>
        <OnboardingPage onComplete={onComplete} />
        <ModalRenderer />
      </ModalProvider>
    </IntegrationsProvider>
  );
}

function ProgressRing({ fraction }: { fraction: number }) {
  const circumference = 2 * Math.PI * 7;
  return (
    <svg viewBox="0 0 18 18" className="size-4.5 -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        className="stroke-text-muted transition-[stroke-dashoffset] duration-500"
      />
    </svg>
  );
}

/**
 * One page, no Continue. Every control commits on use, so a section is
 * finished the moment its control is used and the next one the user can act
 * on lifts. The only exit is the sticky "Open Chord" bar, gated on the agent
 * scan alone: everything else is skippable — invited teammates and evaluators
 * may have no repo or team yet, and the dashboard's empty states pick those up.
 */
function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [scanning, setScanning] = useState(true);
  const [selected, setSelected] = useState<AgentProviderId | null>(null);
  const [workspaceDone, setWorkspaceDone] = useState(false);
  const [githubDone, setGithubDone] = useState(false);
  const [repoDone, setRepoDone] = useState(false);
  const [inviteDone, setInviteDone] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [harnessAgents, setHarnessAgents] = useState<DetectedAgent[]>([]);
  const { data: localData } = useResourceData(dependenciesStore.local);
  const { update: updateDefaultAgent } = useAppSettingsKey('defaultAgent');

  useEffect(() => {
    let cancelled = false;

    const detect = rpc.skills.getDetectedAgents().then((result) => {
      if (cancelled) return;
      if (result.data) {
        setHarnessAgents(result.data);
        return;
      }
      setDetectionError(result.error ?? 'Agent detection failed.');
    });

    // Both probes must settle before the step reports a count, otherwise the
    // description claims "no agents" while detection is still running.
    void Promise.allSettled([dependenciesStore.probeAll(), detect]).then(() => {
      if (!cancelled) setScanning(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const harnessIds = useMemo(
    () => new Set(harnessAgents.filter((a) => a.installed).map((a) => a.id)),
    [harnessAgents]
  );

  const detectedAgents = useMemo(() => {
    if (!localData) return [];
    const cliDetected = DETECTABLE_AGENTS.filter((p) => localData[p.id]?.status === 'available');
    const harnessOnly = AGENT_PROVIDERS.filter(
      (p) => harnessIds.has(p.id) && !cliDetected.some((c) => c.id === p.id)
    );
    return [...cliDetected, ...harnessOnly];
  }, [localData, harnessIds]);

  // Default to the first detected agent until the user picks one explicitly —
  // derived at render, never synced into state.
  const selectedAgent = selected ?? (scanning ? null : (detectedAgents[0]?.id ?? null));

  const handleWorkspaceDone = useCallback(() => setWorkspaceDone(true), []);
  const handleGithubConnected = useCallback(() => setGithubDone(true), []);
  const handleRepoDone = useCallback(() => setRepoDone(true), []);
  const handleInvited = useCallback(() => setInviteDone(true), []);

  // A pick commits immediately, like every other control on the page — the
  // exit only persists the auto-derived default when nothing was picked.
  const handleSelectAgent = useCallback(
    (id: AgentProviderId) => {
      setSelected(id);
      updateDefaultAgent(id);
    },
    [updateDefaultAgent]
  );

  const handleComplete = useCallback(() => {
    if (selectedAgent) {
      updateDefaultAgent(selectedAgent);
    }
    onComplete();
  }, [selectedAgent, updateDefaultAgent, onComplete]);

  // Order matches the sections below.
  const { remaining, total, nextIndex } = summarizeProgress([
    { done: workspaceDone, optional: false, pending: false },
    { done: !scanning, optional: false, pending: scanning },
    { done: githubDone, optional: false, pending: false },
    { done: repoDone, optional: false, pending: false },
    { done: inviteDone, optional: true, pending: false },
  ]);

  const exitMessage = scanning ? (
    'Waiting for the agent scan to finish…'
  ) : remaining > 0 ? (
    <>
      <span className="font-medium text-text-muted">{remaining} left</span> — skip anything and
      finish it later from Settings.
    </>
  ) : inviteDone ? (
    "You're all set."
  ) : (
    "You're set up. Inviting your team is optional."
  );

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-170 px-6 pt-14 pb-10">
          <div className="animate-fade-up mb-7 flex items-end gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-4 flex items-center gap-2">
                <ChordMark alt="" className="size-5.5" />
                <span className="text-body tracking-body font-semibold text-text-muted">Chord</span>
              </div>
              <h1 className="text-display tracking-display font-bold text-text">Set up Chord</h1>
              <p className="mt-1.5 text-body tracking-body text-text-passive">
                A few things so your first work item just runs. Everything saves as you go.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pb-1 text-tiny tracking-tiny whitespace-nowrap text-text-passive">
              <ProgressRing fraction={(total - remaining) / total} />
              {remaining > 0 ? (
                <span>
                  <span className="font-medium tabular-nums text-text-muted">{remaining}</span> of{' '}
                  {total} remaining
                </span>
              ) : (
                <span>All set</span>
              )}
            </div>
          </div>

          <div className="animate-fade-up flex flex-col gap-3" style={{ animationDelay: '60ms' }}>
            <OnboardingWorkspaceSection
              index={0}
              isNext={nextIndex === 0}
              onDone={handleWorkspaceDone}
            />
            <OnboardingAgentSection
              index={1}
              isNext={nextIndex === 1}
              scanning={scanning}
              detectedAgents={detectedAgents}
              selectedAgent={selectedAgent}
              onSelect={handleSelectAgent}
              detectionError={detectionError}
              localDependencies={localData}
            />
            <OnboardingAccountsSection
              index={2}
              isNext={nextIndex === 2}
              onGithubConnected={handleGithubConnected}
            />
            <OnboardingRepoSection index={3} isNext={nextIndex === 3} onDone={handleRepoDone} />
            <OnboardingInviteSection index={4} isNext={nextIndex === 4} onInvited={handleInvited} />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-surface">
        <div className="mx-auto flex h-15 w-full max-w-170 items-center gap-3 px-6">
          <p className="flex-1 text-tiny tracking-tiny text-text-passive">{exitMessage}</p>
          <Button size="sm" onClick={handleComplete} disabled={scanning}>
            Open Chord
            <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
