import type { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import { isExpired, nextPointerDeadline, opacityFor } from './remote-pointer-timing';

interface RemotePointersProps {
  provider: HocuspocusProvider;
}

interface RemotePointer {
  clientId: number;
  name: string;
  color: string;
  x: number;
  y: number;
  lastMoved: number;
}

export function RemotePointers({ provider }: RemotePointersProps) {
  const [pointers, setPointers] = useState<RemotePointer[]>([]);

  useEffect(() => {
    const awareness = provider.awareness;
    if (!awareness) return;

    const syncPointers = () => {
      const now = Date.now();
      const states = awareness.getStates();
      setPointers((prev) => {
        const byClientId = new Map(prev.map((p) => [p.clientId, p]));
        const next: RemotePointer[] = [];
        states.forEach((state, clientId) => {
          if (clientId === awareness.clientID) return;
          const pointer = state.pointer as { x: number; y: number } | null | undefined;
          const user = state.user as { name: string; color: string } | undefined;
          if (!pointer || !user) return;

          const existing = byClientId.get(clientId);
          const moved = !existing || existing.x !== pointer.x || existing.y !== pointer.y;
          next.push({
            clientId,
            name: user.name,
            color: user.color,
            x: pointer.x,
            y: pointer.y,
            lastMoved: moved ? now : existing.lastMoved,
          });
        });
        return next;
      });
    };

    syncPointers();
    awareness.on('update', syncPointers);
    return () => {
      awareness.off('update', syncPointers);
    };
  }, [provider]);

  const [now, setNow] = useState(() => Date.now());

  // Pointer positions change only on an awareness update; the sole thing that
  // changes on a clock is a pointer crossing its fade or expiry deadline. So
  // wake exactly at the next deadline instead of polling every second — with no
  // peers pointing at the document there is no timer at all.
  useEffect(() => {
    const scheduledAt = Date.now();
    const deadline = nextPointerDeadline(pointers, scheduledAt);
    if (deadline === null) return;

    const timer = setTimeout(() => {
      const t = Date.now();
      setNow(t);
      setPointers((prev) => prev.filter((p) => !isExpired(p, t)));
    }, deadline - scheduledAt);
    return () => clearTimeout(timer);
    // `now` re-arms the timer after a fade wake-up so the later expiry deadline
    // is still scheduled even when the pointer set itself did not change.
  }, [pointers, now]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 50 }}>
      {pointers.map((pointer) => {
        if (isExpired(pointer, now)) return null;
        const opacity = opacityFor(pointer, now);

        return (
          <div
            key={pointer.clientId}
            className="remote-pointer"
            style={{ left: pointer.x, top: pointer.y, opacity }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M0.5 0.5L5.5 14L7.5 8.5L14 6.5L0.5 0.5Z"
                fill={pointer.color}
                stroke="var(--remote-pointer-stroke)"
                strokeWidth="1"
              />
            </svg>
            <span className="remote-pointer__label" style={{ background: pointer.color }}>
              {pointer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
