import { useEffect, useState } from 'react';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { PtyPane } from '@renderer/lib/pty/pty-pane';

/**
 * A run script's or the test's terminal: its output so far (the main
 * process keeps the buffer after the process exits) and what follows. Input
 * goes to the process, so Ctrl+C typed here works as in any terminal.
 */
export function RunTerminal({ ptySessionId }: { ptySessionId: string }) {
  const [pty, setPty] = useState<FrontendPty | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const frontendPty = new FrontendPty(ptySessionId);
    frontendPty
      .connect()
      .then(() => {
        if (!disposed) setPty(frontendPty);
      })
      .catch((err: unknown) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      disposed = true;
      frontendPty.dispose();
      setPty(null);
    };
  }, [ptySessionId]);

  if (error) {
    return (
      <p role="alert" className="text-tiny tracking-tiny text-status-err">
        Terminal failed to connect: {error}
      </p>
    );
  }
  return (
    <div className="flex h-56 overflow-hidden rounded-xs border border-border-subtle">
      {pty ? (
        <PtyPane sessionId={ptySessionId} pty={pty} />
      ) : (
        <span className="m-auto text-tiny tracking-tiny text-text-passive">Connecting…</span>
      )}
    </div>
  );
}
