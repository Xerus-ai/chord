import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { FOCUS_RING } from '@renderer/lib/ui/focus-ring';
import { cn } from '@renderer/utils/utils';
import { AuthFlowTrack } from './auth-flow-track';
import { AuthPreviewPanel } from './auth-preview-panel';
import { ChordWordmark } from './chord-wordmark';

/**
 * Boot phases, in order. The old sequence opened on an orange line expanding
 * across a CRT bezel; the wordmark rasters in instead, so the first thing on
 * screen is the product's name rather than a stray accent blip.
 */
type BootPhase = 'dark' | 'raster' | 'tagline' | 'flow' | 'reveal' | 'ready';

const SEQUENCE: [BootPhase, number][] = [
  ['raster', 420],
  ['tagline', 420],
  ['flow', 360],
  ['reveal', 620],
  ['ready', 260],
];

const AFTER: Record<Exclude<BootPhase, 'dark'>, BootPhase[]> = {
  raster: ['raster', 'tagline', 'flow', 'reveal', 'ready'],
  tagline: ['tagline', 'flow', 'reveal', 'ready'],
  flow: ['flow', 'reveal', 'ready'],
  reveal: ['reveal', 'ready'],
  ready: ['ready'],
};

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useBootPhase(): BootPhase {
  // Someone who asked the OS for less motion gets the finished screen, not a
  // faster version of the animation — so they START at 'ready' rather than
  // being moved there by an effect.
  const [phase, setPhase] = useState<BootPhase>(() => (prefersReducedMotion() ? 'ready' : 'dark'));
  const hasBooted = useRef(false);

  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;
    if (prefersReducedMotion()) return;

    // Each step owns its timer, so unmounting mid-boot must clear all of them —
    // keeping only the last handle left earlier phases firing after unmount.
    const timers: ReturnType<typeof setTimeout>[] = [];
    let elapsed = 0;
    for (const [next, delay] of SEQUENCE) {
      elapsed += delay;
      timers.push(setTimeout(() => setPhase(next), elapsed));
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  return phase;
}

/**
 * The legal links open in the user's browser. Their URLs come from
 * main-process config (`CHORD_TERMS_URL` / `CHORD_PRIVACY_URL`), so until that
 * read resolves the label renders as plain text rather than a link to nowhere.
 */
function LegalLink({ label, url }: { label: string; url: string | undefined }) {
  if (!url) {
    return <span className="text-text-passive">{label}</span>;
  }
  return (
    <button
      onClick={() => void rpc.app.openExternal(url)}
      className={cn(
        'cursor-pointer rounded border-none bg-transparent p-0 text-tiny tracking-tiny text-text-passive underline-offset-2 hover:text-text-muted hover:underline',
        FOCUS_RING
      )}
    >
      {label}
    </button>
  );
}

export function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const phase = useBootPhase();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: publicUrls } = useQuery({
    queryKey: ['app', 'publicUrls'],
    queryFn: () => rpc.app.getPublicUrls(),
    staleTime: Infinity,
  });

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      const result = await rpc.account.signIn();
      if (result.success) {
        onAuthenticated();
      } else {
        setError(result.error ?? 'Sign-in failed. Please try again.');
      }
    } catch {
      setError('Unable to connect. Check your internet and try again.');
    } finally {
      setSigningIn(false);
    }
  }, [onAuthenticated]);

  const shown = (after: Exclude<BootPhase, 'dark'>) => AFTER[after].includes(phase);
  const ready = phase === 'ready';
  const stage = 'transition-[opacity,transform] duration-[520ms] ease-[cubic-bezier(.33,1,.68,1)]';

  return (
    // The window's minimum is 700×500, where this content is taller than the
    // viewport. Scrolling (rather than `overflow-hidden`) keeps the wordmark
    // and the CTA reachable instead of cropping them off the top and bottom.
    <div className="relative h-screen select-none overflow-y-auto overflow-x-hidden bg-surface text-text">
      {/* Atmosphere. Fixed, not absolute, so the wash stays put if the content
          scrolls. The bloom reuses the brand-derived ambient glow token, so it
          can never drift to a different orange than the button. */}
      <div
        className={cn(
          'pointer-events-none fixed inset-0 z-[1] transition-opacity duration-[900ms]',
          phase === 'dark' ? 'opacity-0' : 'opacity-100'
        )}
        style={{
          background:
            'radial-gradient(ellipse 66% 48% at 50% 30%, var(--surface-hover) 0%, transparent 76%)',
        }}
      />
      <div
        className={cn(
          'pointer-events-none fixed inset-0 z-[3] transition-opacity duration-[600ms]',
          phase === 'dark' ? 'opacity-0' : 'opacity-50'
        )}
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, var(--crt-scanline) 2px, var(--crt-scanline) 4px)',
          animation: phase === 'dark' ? 'none' : 'scanline-drift 8s linear infinite',
        }}
      />

      {/* min-h-full + my-auto rather than `items-center` on the scroll
          container: centring a flex child that overflows makes its top
          unreachable in Chromium. */}
      <div className="relative z-[4] flex min-h-full items-center justify-center px-16 py-10">
        <div className="w-full max-w-[1180px]">
          {/* The raster is drawn at a fixed cell size, so it shrinks by transform
            inside a box whose height tracks the scale. */}
          <div className="mb-[18px] flex h-[54px] items-center justify-center xl:h-[75px]">
            <div className="origin-center scale-[.72] xl:scale-100">
              <ChordWordmark lit={phase !== 'dark'} />
            </div>
          </div>

          <p
            className={cn(
              'mb-8 text-center text-body tracking-body text-text-passive xl:mb-[52px]',
              stage,
              shown('tagline') ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
            )}
          >
            Where teams align before agents build
          </p>

          <div className="flex items-start justify-center gap-[52px] xl:justify-start">
            <div className="w-[472px] max-w-full shrink-0 pt-1.5">
              <p
                className={cn(
                  'mb-1.5 text-body tracking-body font-semibold text-text',
                  stage,
                  shown('tagline') ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                )}
              >
                Align, then build. Every cycle.
              </p>
              <p
                style={{ transitionDelay: '60ms' }}
                className={cn(
                  'mb-[86px] text-tiny tracking-tiny text-text-passive xl:mb-[92px]',
                  stage,
                  shown('tagline') ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                )}
              >
                Your issues and your team shape one shared plan. Agents only build what everyone
                agreed to.
              </p>

              <AuthFlowTrack drawn={shown('flow')} sourcesShown={shown('reveal')} />

              <button
                onClick={handleSignIn}
                disabled={!ready || signingIn}
                className={cn(
                  'mt-12 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-body tracking-body font-semibold xl:mt-[74px]',
                  'bg-action-bg text-action-fg',
                  stage,
                  FOCUS_RING,
                  ready
                    ? 'translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0',
                  ready && !signingIn && 'hover:bg-action-bg-hover hover:-translate-y-px',
                  signingIn && 'cursor-wait opacity-70'
                )}
              >
                {signingIn ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Sign in'
                )}
              </button>

              {error && (
                <p className="mt-4 max-w-[320px] text-tiny tracking-tiny text-status-err">
                  {error}
                </p>
              )}

              <p
                style={{ transitionDelay: '80ms' }}
                className={cn(
                  'mt-3 text-micro tracking-micro text-text-passive',
                  stage,
                  ready ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
                )}
              >
                By signing in, you agree to our <LegalLink label="Terms" url={publicUrls?.terms} />{' '}
                & <LegalLink label="Privacy" url={publicUrls?.privacy} />
              </p>
            </div>

            <AuthPreviewPanel shown={shown('reveal')} cursorLit={shown('reveal')} />
          </div>
        </div>
      </div>
    </div>
  );
}
