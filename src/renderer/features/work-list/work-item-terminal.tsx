import { useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { FrontendPty } from '@renderer/lib/pty/pty';
import { PtyPane } from '@renderer/lib/pty/pty-pane';

export function WorkItemTerminal({ sessionId }: { sessionId: string }) {
  const ptyId = `session:${sessionId}`;
  const [pty, setPty] = useState<FrontendPty | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let frontendPty: FrontendPty | null = null;
    // Resume first: revives a suspended terminal (app restart, CLI exited)
    // before attaching. A no-op when the session is already live.
    void rpc.agentSessions
      .resume(sessionId)
      .then((result) => {
        if (!result.success) throw new Error('Terminal session not found');
        if (disposed) return;
        frontendPty = new FrontendPty(ptyId);
        return frontendPty.connect().then(() => {
          if (!disposed) setPty(frontendPty);
        });
      })
      .catch((err) => {
        frontendPty?.dispose();
        frontendPty = null;
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'Failed to connect to terminal');
        }
      });
    return () => {
      disposed = true;
      frontendPty?.dispose();
      setPty(null);
    };
  }, [ptyId, sessionId]);

  // A terminal the user just opened takes the keyboard once attached. Hidden
  // (retained, inactive) tabs have no offsetParent and must not steal focus.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<{ focus: () => void } | null>(null);
  useEffect(() => {
    if (!pty || wrapperRef.current?.offsetParent == null) return;
    paneRef.current?.focus();
  }, [pty]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-body tracking-body text-text-passive">
        <span>Terminal failed to connect</span>
        <span className="max-w-[400px] text-center text-tiny tracking-tiny text-text-passive">
          {error}
        </span>
      </div>
    );
  }

  if (!pty) {
    return (
      <div className="flex flex-1 items-center justify-center text-body tracking-body text-text-passive">
        Connecting to terminal…
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="flex flex-1 overflow-hidden">
      <PtyPane ref={paneRef} sessionId={ptyId} pty={pty} />
    </div>
  );
}
