import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import githubSvg from '@/assets/images/Github.svg?raw';
import jiraSvg from '@/assets/images/Jira.svg?raw';
import linearSvg from '@/assets/images/Linear.svg?raw';
import { useIntegrationsContext } from '@renderer/features/integrations/integrations-provider';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SvgIcon } from './onboarding-cards';
import {
  FooterAction,
  OnboardingSection,
  RowStatus,
  RowTag,
  RowTile,
  SectionFooter,
  SectionRow,
} from './onboarding-section';

function ConnectControl({
  connected,
  loading,
  onConnect,
}: {
  connected: boolean;
  loading: boolean;
  onConnect: () => void;
}) {
  if (connected) return <RowStatus>Connected</RowStatus>;
  if (loading) return <Loader2 className="size-icon-md animate-spin text-text-passive" />;
  return (
    <Button variant="outline" size="xs" onClick={onConnect}>
      Connect
    </Button>
  );
}

const logoTile = (raw: string) => (
  <RowTile>
    <SvgIcon raw={raw} className="size-icon-sm" />
  </RowTile>
);

/**
 * The accounts step. It completes on GitHub — the one connection Chord needs
 * to open pull requests and follow their checks — while Linear and Jira are
 * labelled optional rather than silently not counting.
 */
export function OnboardingAccountsSection({
  index,
  isNext,
  onGithubConnected,
}: {
  index: number;
  isNext: boolean;
  onGithubConnected: () => void;
}) {
  const [githubLogin, setGithubLogin] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [statusAttempt, setStatusAttempt] = useState(0);

  const { isLinearConnected, isLinearLoading, isJiraConnected, isJiraLoading } =
    useIntegrationsContext();
  const showIntegrationSetup = useShowModal('integrationSetupModal');

  useEffect(() => {
    if (githubConnected) onGithubConnected();
  }, [githubConnected, onGithubConnected]);

  /**
   * A linked GitHub account is machine state, not something this run did: a
   * second account on a shared machine, or a reinstall that kept the local
   * database, must not be offered Connect for a connection that is live.
   *
   * Read straight from the RPC rather than `useGithubContext`: onboarding
   * mounts outside `AppContent`, so that provider has no instance here yet.
   */
  useEffect(() => {
    let cancelled = false;

    rpc.github.getStatus().then(
      (status) => {
        if (cancelled) return;
        setGithubConnected(status.authenticated);
        setGithubLogin(status.user?.login ?? null);
      },
      (error: unknown) => {
        // getStatus rejects instead of reporting `authenticated: false`, so a
        // failure means unknown, not disconnected. Say so and leave the row
        // actionable rather than asserting a state that was never read.
        if (!cancelled) {
          setGithubError(
            `Couldn't check your GitHub connection: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [statusAttempt]);

  // connectOAuth resolves with { success: false } instead of throwing, so the
  // result has to be inspected — marking the row "Connected" on a rejected
  // OAuth flow left the user believing GitHub was linked when it was not.
  const handleGithubConnect = useCallback(async () => {
    setGithubError(null);
    setGithubConnecting(true);
    try {
      const result = await rpc.github.connectOAuth();
      if (!result.success) {
        setGithubError(result.error ?? 'GitHub connection failed.');
        return;
      }
      setGithubConnected(true);
      setGithubLogin(result.user?.login ?? null);
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : String(error));
    } finally {
      setGithubConnecting(false);
    }
  }, []);

  return (
    <OnboardingSection
      index={index}
      isNext={isNext}
      title="Connect GitHub"
      meta={{ kind: 'estimate', label: '1 min' }}
      description="Chord opens pull requests and follows their checks through GitHub."
      state={githubError ? 'error' : githubConnected ? 'done' : 'todo'}
      answer={
        githubConnected && (
          <span className="font-medium text-text-muted">{githubLogin ?? 'Connected'}</span>
        )
      }
      footer={
        githubError && (
          <SectionFooter tone="error">
            {githubError}
            <FooterAction
              onClick={() => {
                setGithubError(null);
                setStatusAttempt((n) => n + 1);
              }}
            >
              Retry
            </FooterAction>
          </SectionFooter>
        )
      }
    >
      <SectionRow
        leading={logoTile(githubSvg)}
        label="GitHub"
        detail={
          githubConnected && githubLogin
            ? `Signed in as ${githubLogin}`
            : 'Pull requests, checks and reviews'
        }
        control={
          <ConnectControl
            connected={githubConnected}
            loading={githubConnecting}
            onConnect={() => void handleGithubConnect()}
          />
        }
      />
      <SectionRow
        leading={logoTile(linearSvg)}
        label={
          <>
            Linear
            <RowTag>Optional</RowTag>
          </>
        }
        detail="Link issues to work items"
        control={
          <ConnectControl
            connected={!!isLinearConnected}
            loading={isLinearLoading}
            onConnect={() => showIntegrationSetup({ integration: 'linear' })}
          />
        }
      />
      <SectionRow
        leading={logoTile(jiraSvg)}
        label={
          <>
            Jira
            <RowTag>Optional</RowTag>
          </>
        }
        detail="Link tickets to work items"
        control={
          <ConnectControl
            connected={!!isJiraConnected}
            loading={isJiraLoading}
            onConnect={() => showIntegrationSetup({ integration: 'jira' })}
          />
        }
      />
    </OnboardingSection>
  );
}
