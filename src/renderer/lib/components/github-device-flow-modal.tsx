import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  githubAuthDeviceCodeChannel,
  githubAuthErrorChannel,
  githubAuthSuccessChannel,
} from '@shared/events/githubEvents';
import type { GitHubUser } from '@shared/github';
import { ChordMark } from '@renderer/lib/components/chord-mark';
import {
  DeviceFlowError,
  DeviceFlowSuccess,
  DeviceFlowWaiting,
} from '@renderer/lib/components/github-device-flow-states';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useGithubContext } from '@renderer/lib/providers/github-context-provider';
import { log } from '@renderer/utils/logger';

const DEVICE_CODE_LIFETIME_SECONDS = 900;

interface GithubDeviceFlowModalProps {
  onClose: () => void;
  onError?: (error: string) => void;
}

type GithubDeviceFlowOverlayExtraProps = {
  onError?: (error: string) => void;
};

export function GithubDeviceFlowModalOverlay({
  onClose,
  onError,
}: GithubDeviceFlowOverlayExtraProps & BaseModalProps<unknown>) {
  // Closing on error made the modal's error state unreachable through the
  // registry — the failure flashed past as a toast and the user was left
  // staring at the settings page. The modal stays open and explains itself;
  // the caller is still told so it can react.
  return <GithubDeviceFlowModal onClose={onClose} onError={onError} />;
}

export function GithubDeviceFlowModal({ onClose, onError }: GithubDeviceFlowModalProps) {
  const { toast } = useToast();
  const { cancelGithubConnect } = useGithubContext();
  const { data: publicUrls } = useQuery({
    queryKey: ['app', 'publicUrls'],
    queryFn: () => rpc.app.getPublicUrls(),
    staleTime: Infinity,
  });

  // Presentational state - updated via IPC events from main process
  const [userCode, setUserCode] = useState<string>('');
  const [verificationUri, setVerificationUri] = useState<string>('');
  const [timeRemaining, setTimeRemaining] = useState<number>(DEVICE_CODE_LIFETIME_SECONDS);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [browserOpening, setBrowserOpening] = useState(false);
  const [browserOpenCountdown, setBrowserOpenCountdown] = useState(3);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutocopied = useRef(false);
  const hasOpenedBrowser = useRef(false);
  const authSucceededRef = useRef(false);

  // Cancel the auth flow if the modal is dismissed before auth completes
  useEffect(() => {
    return () => {
      if (!authSucceededRef.current) {
        cancelGithubConnect();
      }
    };
  }, [cancelGithubConnect]);

  // Countdown timer for code expiration
  useEffect(() => {
    if (success || error) return;

    countdownIntervalRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setError('Code expired. Please try again.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [success, error]);

  // Reset state on mount (new auth flow)
  useEffect(() => {
    setSuccess(false);
    setError(null);
    setUser(null);
    setCopied(false);
    hasAutocopied.current = false;
    hasOpenedBrowser.current = false;
  }, []);

  const copyToClipboard = useCallback(
    async (code: string, isAutomatic = false) => {
      try {
        await navigator.clipboard.writeText(code);

        setCopied(true);

        if (!isAutomatic) {
          toast({
            title: '✓ Code copied',
            description: 'Paste it in GitHub to authorize',
          });
        }

        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        log.error('Failed to copy:', err);
        if (!isAutomatic) {
          toast({
            title: 'Copy failed',
            description: 'Please copy the code manually',
            variant: 'destructive',
          });
        }
      }
    },
    [toast]
  );

  const openGitHub = useCallback(() => {
    if (verificationUri) {
      void rpc.app.openExternal(verificationUri);
    }
  }, [verificationUri]);

  // Subscribe to auth events from main process
  useEffect(() => {
    // Device code received - display to user
    const cleanupDeviceCode = events.on(githubAuthDeviceCodeChannel, (data) => {
      setUserCode(data.userCode);
      setVerificationUri(data.verificationUri);
      setTimeRemaining(data.expiresIn);

      // Auto-copy code
      if (!hasAutocopied.current) {
        hasAutocopied.current = true;
        void copyToClipboard(data.userCode, true);

        // Show countdown and open browser after 3 seconds
        setBrowserOpening(true);
        let countdown = 3;
        const countdownTimer = setInterval(() => {
          countdown--;
          setBrowserOpenCountdown(countdown);
          if (countdown <= 0) {
            clearInterval(countdownTimer);
          }
        }, 1000);

        setTimeout(() => {
          setBrowserOpening(false);
          if (!hasOpenedBrowser.current) {
            hasOpenedBrowser.current = true;
            void rpc.app.openExternal(data.verificationUri);
          }
        }, 3000);
      }
    });

    // Auth successful
    const cleanupSuccess = events.on(githubAuthSuccessChannel, (data) => {
      authSucceededRef.current = true;
      setSuccess(true);
      setUser(data.user);

      // Auto-close after showing success animation
      setTimeout(() => {
        onClose();
      }, 1000); // 1 second is enough to see success
    });

    // Auth error. The inline error state below is what the user reads; the
    // caller's toast is the only notification, so the modal adds none of its
    // own on top of it.
    const cleanupError = events.on(githubAuthErrorChannel, (data) => {
      setError(data.message || data.error);
      onError?.(data.error);
    });

    // Cleanup listeners on unmount
    return () => {
      cleanupDeviceCode();
      cleanupSuccess();
      cleanupError();
    };
  }, [copyToClipboard, onError, onClose]);

  const handleClose = () => {
    onClose();
  };

  const handleRetry = useCallback(() => {
    setError(null);
    setUserCode('');
    setVerificationUri('');
    setCopied(false);
    hasAutocopied.current = false;
    hasOpenedBrowser.current = false;
    setTimeRemaining(DEVICE_CODE_LIFETIME_SECONDS);

    // The failed flow may still be polling GitHub with the dead code; stopping
    // it first keeps a single device flow in flight.
    rpc.github
      .authCancel()
      .then(() => rpc.github.auth())
      .then(
        (result) => {
          if (!result.success) setError(result.error ?? 'Authentication failed.');
        },
        (authError: unknown) => {
          setError(authError instanceof Error ? authError.message : 'Authentication failed.');
        }
      );
  }, []);

  // Keyboard shortcuts (Escape is handled by DialogContent's onEscapeKeyDown).
  // Cmd/Ctrl+C only stands in for the copy button when there is nothing to
  // copy — swallowing it unconditionally broke copying the code by selecting
  // it, and every other selection on the page along with it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = e.metaKey || e.ctrlKey;
      if (modifier && e.key === 'c') {
        const selection = window.getSelection()?.toString() ?? '';
        if (selection.length > 0 || !userCode) return;
        e.preventDefault();
        void copyToClipboard(userCode);
      } else if (e.key === 'Enter') {
        openGitHub();
      } else if (modifier && e.key === 'r') {
        e.preventDefault();
        openGitHub();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copyToClipboard, openGitHub, userCode]);

  return (
    <div className="flex flex-col items-center px-8 py-12">
      <ChordMark className="mb-8 size-8 opacity-90" />

      {success ? (
        <DeviceFlowSuccess user={user} />
      ) : error ? (
        <DeviceFlowError message={error} onClose={handleClose} onRetry={handleRetry} />
      ) : (
        <DeviceFlowWaiting
          userCode={userCode}
          verificationUri={verificationUri}
          timeRemaining={timeRemaining}
          copied={copied}
          browserOpening={browserOpening}
          browserOpenCountdown={browserOpenCountdown}
          issuesUrl={publicUrls?.issues}
          onCopy={() => void copyToClipboard(userCode)}
          onOpenGitHub={openGitHub}
        />
      )}
    </div>
  );
}
