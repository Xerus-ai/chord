import { AlertCircle, Check, Copy, ExternalLink } from 'lucide-react';
import type { GitHubUser } from '@shared/github';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';

const IS_MAC_PLATFORM =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const COPY_HINT = IS_MAC_PLATFORM ? '⌘C' : 'Ctrl+C';
const REOPEN_HINT = IS_MAC_PLATFORM ? '⌘R' : 'Ctrl+R';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function DeviceFlowSuccess({ user }: { user: GitHubUser | null }) {
  return (
    <div className="flex flex-col items-center space-y-6 duration-300 animate-in fade-in zoom-in">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-status-ok duration-500 animate-in zoom-in">
        <Check className="h-8 w-8 text-action-fg" strokeWidth={3} />
      </div>
      <div className="space-y-2 text-center">
        <h2 className="text-display tracking-display font-semibold text-text">Success!</h2>
        <p className="text-body tracking-body text-text-passive">You're connected to GitHub</p>
        {user && (
          <div className="mt-4 flex items-center justify-center gap-2">
            {user.avatar_url && (
              <img src={user.avatar_url} alt={user.name} className="h-10 w-10 rounded-full" />
            )}
            <div className="text-left">
              <p className="text-body tracking-body font-medium text-text">
                {user.name || user.login}
              </p>
              <p className="text-tiny tracking-tiny text-text-passive">@{user.login}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DeviceFlowError({
  message,
  onClose,
  onRetry,
}: {
  message: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center space-y-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-status-err-bg">
        <AlertCircle className="h-8 w-8 text-status-err" />
      </div>
      <div className="space-y-2 text-center">
        <h2 className="text-title tracking-title font-semibold text-text">Authentication Failed</h2>
        <p className="text-body tracking-body text-text-passive">{message}</p>
      </div>
      <div className="flex w-full gap-2">
        <Button onClick={onClose} variant="outline" className="flex-1">
          Close
        </Button>
        <Button onClick={onRetry} className="flex-1">
          Try again
        </Button>
      </div>
    </div>
  );
}

interface DeviceFlowWaitingProps {
  userCode: string;
  verificationUri: string;
  timeRemaining: number;
  copied: boolean;
  browserOpening: boolean;
  browserOpenCountdown: number;
  issuesUrl: string | undefined;
  onCopy: () => void;
  onOpenGitHub: () => void;
}

export function DeviceFlowWaiting({
  userCode,
  verificationUri,
  timeRemaining,
  copied,
  browserOpening,
  browserOpenCountdown,
  issuesUrl,
  onCopy,
  onOpenGitHub,
}: DeviceFlowWaitingProps) {
  return (
    <div className="flex w-full flex-col items-center space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-display tracking-display font-semibold text-text">Connect to GitHub</h2>
        <p className="text-body tracking-body text-text-passive">
          Follow these steps to authorize Chord
        </p>
      </div>

      {userCode && (
        <>
          <div className="w-full space-y-3 rounded-lg bg-surface-inset p-6">
            <p className="text-center text-tiny tracking-tiny font-medium text-text-passive">
              Your code
            </p>
            <p className="select-all text-center font-mono text-[36px] font-bold leading-10 tracking-wider text-text">
              {userCode}
            </p>
          </div>

          <Button onClick={onCopy} variant="outline" className="w-full" disabled={copied}>
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                Copy Code
              </>
            )}
          </Button>
        </>
      )}

      <div className="w-full space-y-3 text-body tracking-body">
        <Step index={1}>
          Paste the code in GitHub <span className="font-medium text-text">(already copied!)</span>
        </Step>
        <Step index={2}>Click Authorize</Step>
      </div>

      {browserOpening && (
        <div className="w-full rounded-lg border border-status-running/20 bg-status-running/10 p-4">
          <p className="text-center text-body tracking-body text-status-running">
            Opening GitHub in {browserOpenCountdown}s...
          </p>
        </div>
      )}

      <div className="flex flex-col items-center gap-2 text-center">
        <Spinner className="h-5 w-5 text-text-passive" />
        <p className="text-body tracking-body text-text-passive">Waiting for authorization...</p>
        {timeRemaining > 0 && (
          <p className="text-tiny tracking-tiny text-text-passive">
            Code expires in {formatTime(timeRemaining)}
          </p>
        )}
      </div>

      {verificationUri && !browserOpening && (
        <Button onClick={onOpenGitHub} className="w-full" size="lg">
          <ExternalLink className="mr-2 h-4 w-4" />
          Open GitHub
        </Button>
      )}

      {issuesUrl && (
        <div className="w-full border-t border-border pt-4">
          <p className="text-center text-tiny tracking-tiny text-text-passive">
            Having{' '}
            <button
              onClick={() => void rpc.app.openExternal(issuesUrl)}
              className="text-text underline-offset-2 hover:underline focus:underline focus:outline-none"
            >
              trouble
            </button>
            ?
          </p>
        </div>
      )}

      <div className="space-x-3 text-center text-tiny tracking-tiny text-text-passive">
        <span>{COPY_HINT} to copy</span>
        <span>•</span>
        <span>{REOPEN_HINT} to reopen</span>
        <span>•</span>
        <span>Esc to cancel</span>
      </div>
    </div>
  );
}

function Step({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-surface-inset text-tiny tracking-tiny font-semibold text-text">
        {index}
      </div>
      <p className="text-text-passive">{children}</p>
    </div>
  );
}
