import githubLogo from '@/assets/images/Github.svg';
import jiraLogo from '@/assets/images/Jira.svg';
import linearLogo from '@/assets/images/Linear.svg';
import { cn } from '@renderer/utils/utils';

type SegmentKind = 'plan' | 'build' | 'review';

/**
 * Deliberately uneven widths and dot counts. A uniform grid reads as a
 * progress bar; real work alternates in irregular bursts, and that irregularity
 * is the whole point of the picture.
 */
const SEGMENTS: { kind: SegmentKind; width: number; dots: number; label: string; delay: number }[] =
  [
    { kind: 'plan', width: 84, dots: 4, label: 'plan', delay: 0 },
    { kind: 'build', width: 38, dots: 0, label: 'build', delay: 110 },
    { kind: 'plan', width: 64, dots: 3, label: 'plan', delay: 200 },
    { kind: 'build', width: 32, dots: 0, label: 'build', delay: 300 },
    { kind: 'plan', width: 50, dots: 2, label: 'plan', delay: 380 },
    { kind: 'build', width: 38, dots: 0, label: 'build', delay: 460 },
    { kind: 'review', width: 48, dots: 2, label: 'review', delay: 540 },
  ];

/**
 * The plan → build → review rhythm, as one continuous line.
 *
 * Plan and review labels sit BELOW the line, build labels ABOVE it. That
 * alternation is what makes the repetition legible as a cycle rather than a
 * sequence of steps.
 *
 * Only integrations Chord actually ships are named here: Linear and Jira for
 * issues, GitHub for PRs.
 */
export function AuthFlowTrack({ drawn, sourcesShown }: { drawn: boolean; sourcesShown: boolean }) {
  return (
    <div className="relative flex w-max items-center gap-[7px]">
      {/* The through-line bleeds past both ends so the cycle reads as ongoing
          rather than as something that starts and stops on screen. */}
      <div
        className={cn(
          'pointer-events-none absolute -left-16 -right-[90px] top-1/2 h-px origin-left bg-border-strong',
          'transition-transform duration-700 ease-[cubic-bezier(.33,1,.68,1)]',
          drawn ? 'scale-x-100' : 'scale-x-0'
        )}
      />

      <div className="absolute inset-x-0 bottom-[calc(100%+34px)] flex items-end justify-between">
        <SourceGroup
          caption="issues & tickets"
          shown={sourcesShown}
          delay={0}
          logos={[
            { src: linearLogo, invertInDark: true },
            { src: jiraLogo, invertInDark: false },
          ]}
        />
        <SourceGroup
          caption="PRs"
          shown={sourcesShown}
          delay={120}
          logos={[{ src: githubLogo, invertInDark: true }]}
        />
      </div>

      {SEGMENTS.map((segment, index) => (
        <div
          key={`${segment.kind}-${index}`}
          style={{ width: segment.width, transitionDelay: `${segment.delay}ms` }}
          className={cn(
            'relative flex h-[26px] shrink-0 items-center justify-center gap-[9px] rounded-full',
            'transition-[opacity,transform] duration-[380ms] ease-[cubic-bezier(.34,1.4,.64,1)]',
            // Build capsules are muted, not orange: orange is reserved for the
            // one thing on this screen the user can act on.
            segment.kind === 'build'
              ? 'bg-text-muted'
              : 'border border-border-strong bg-surface-raised',
            drawn ? 'scale-100 opacity-100' : 'scale-[.82] opacity-0'
          )}
        >
          {Array.from({ length: segment.dots }, (_, dotIndex) => (
            <span key={dotIndex} className="block h-[5px] w-[5px] rounded-full bg-text-muted" />
          ))}
          <span
            className={cn(
              'absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-tiny tracking-tiny text-text-passive',
              segment.kind === 'build' ? 'bottom-[calc(100%+9px)]' : 'top-[calc(100%+9px)]'
            )}
          >
            {segment.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function SourceGroup({
  caption,
  logos,
  shown,
  delay,
}: {
  caption: string;
  logos: { src: string; invertInDark: boolean }[];
  shown: boolean;
  delay: number;
}) {
  return (
    <figure
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'm-0 flex flex-col items-center gap-1.5',
        'transition-[opacity,transform] duration-[520ms] ease-[cubic-bezier(.33,1,.68,1)]',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      )}
    >
      <span className="flex gap-[9px]">
        {logos.map((logo) => (
          <img
            key={logo.src}
            src={logo.src}
            alt=""
            // Linear and GitHub are near-black glyphs and vanish on the dark
            // ground — the same treatment `agentConfig` applies via
            // `invertInDark`.
            className={cn(
              'block h-[26px] w-[26px] rounded-[7px] border border-border-strong bg-surface-raised p-[5px]',
              logo.invertInDark && 'dark:invert'
            )}
          />
        ))}
      </span>
      <figcaption className="whitespace-nowrap text-micro tracking-micro text-text-passive">
        {caption}
      </figcaption>
    </figure>
  );
}
