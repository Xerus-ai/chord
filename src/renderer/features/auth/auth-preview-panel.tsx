import { cn } from '@renderer/utils/utils';

/**
 * A recreation of the Chord workspace, bleeding off the right edge of the
 * sign-in screen.
 *
 * It is an ILLUSTRATION, not a screenshot and not live data: every string is
 * hand-written and plausible, and it depicts only things Chord actually does —
 * a shared plan, teammates present on a work item, agent sessions under one
 * item, checks, and a GitHub PR. It is `aria-hidden` because it argues by
 * picture; nothing here is operable or readable as fact.
 *
 * TYPE-TOKEN EXEMPTION. The literal `text-[Npx]` sizes below are deliberate and
 * are NOT debt to be migrated onto the app ramp (`--text-body`/`--text-tiny`/
 * `--text-micro`, index.css). This panel is a scale drawing: it renders a whole
 * workspace at roughly half size, so its numbers are drawing dimensions, not
 * type-scale steps — `text-[7px]` is a letter inside a 14px avatar, and the
 * 12px floor that governs real UI copy would burst the geometry it sits in.
 * Nothing here is read; it is looked at. The readable copy on this screen
 * (`auth-gate.tsx`, `auth-flow-track.tsx`) is on the tokens and must stay there.
 */
export function AuthPreviewPanel({ shown, cursorLit }: { shown: boolean; cursorLit: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{ transitionDelay: '60ms' }}
      className={cn(
        'mr-[-104px] hidden h-[352px] min-w-0 flex-1 flex-col overflow-hidden rounded-l-lg',
        'border border-r-0 border-border-strong bg-surface-raised text-left font-mono text-[11px] text-text-muted',
        'transition-[opacity,transform] duration-[520ms] ease-[cubic-bezier(.33,1,.68,1)]',
        // Below this the two-column layout has no room; the copy stands alone.
        'xl:flex',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border px-2.5 py-[7px]">
        <span className="font-semibold text-text">&gt;_</span>
        <span className="font-sans text-[12px] font-semibold text-text">Streaming diff viewer</span>
        <Chip>chord</Chip>
        <Chip branch>chord/streaming-diff</Chip>
        <span className="ml-auto flex pr-[104px]">
          <Avatar initial="S" tone="one" />
          <Avatar initial="N" tone="two" />
          <Avatar initial="Y" tone="brand" />
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[196px] shrink-0 border-r border-border p-2.5">
          <SideLabel first>team</SideLabel>
          <Row dot="running" name="sarah / pty-reconnect" diff="+142 −38" />
          <Row dot="review" name="nate / worktree-cleanup" diff="+85 −23" />
          <SideLabel>my work</SideLabel>
          <Row active dot="running" name="Streaming diff viewer" diff="+312 −89" />
          <Row sub name="diff-core · claude code" />
          <Row sub name="diff-tests · codex" />
          <Row sub name="terminal · zsh" />
          <Row dot="idle" name="Session resume banner" diff="+48 −12" />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 gap-0.5 border-b border-border px-2.5 pt-1">
            <Tab active>plan.md</Tab>
            <Tab>chat</Tab>
            <Tab>terminal</Tab>
            <Tab>diff</Tab>
          </div>
          <div className="min-h-0 flex-1 p-3.5 leading-[1.75]">
            <div className="font-semibold text-text"># Streaming diff viewer</div>
            <div>
              <span className="text-text">✓</span> stream hunks as they parse
            </div>
            <div>
              <span className="text-text">✓</span> preserve scroll on refresh
            </div>
            <div>· virtualise files over 2k lines</div>
            <div>
              · collapse unchanged regions
              <span
                className={cn(
                  'text-text',
                  cursorLit
                    ? 'animate-[cursor-blink_1s_step-end_infinite] opacity-100'
                    : 'opacity-0'
                )}
              >
                ▌
              </span>
            </div>
            <div className="mt-2.5">
              <span className="font-semibold text-text">nate</span>{' '}
              <span className="opacity-60">· 2m ago</span>
            </div>
            <div className="opacity-80">worth reusing the hunk parser here?</div>
          </div>
        </main>

        <aside className="w-[200px] shrink-0 border-l border-border p-2.5">
          <SideLabel first>changes</SideLabel>
          <FileRow name="renderer/diff/stream.ts" diff="+198 −45" />
          <FileRow name="main/core/git/diff.ts" diff="+87 −33" />
          <FileRow name="test/diff.spec.ts" diff="+27 −11" />
          <SideLabel>checks</SideLabel>
          <CheckRow name="lint" time="✓ 1m" />
          <CheckRow name="build-main" time="✓ 1m" />
          <CheckRow name="tests" time="✓ 44s" />
          <div className="mt-2 flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] text-text-muted">
            <Avatar initial="N" tone="two" inline />
            nate approved
            <span className="ml-auto text-text tabular-nums">✓</span>
          </div>
          <div className="mt-3 whitespace-nowrap rounded-full border border-status-ok px-2.5 py-0.5 text-center text-[10px] text-status-ok opacity-85">
            PR #247 · ready to merge
          </div>
        </aside>
      </div>
    </div>
  );
}

function Chip({ children, branch }: { children: string; branch?: boolean }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full border px-2 py-px text-[10px]',
        branch ? 'border-action-bg/40 text-text' : 'border-border-strong text-text-passive'
      )}
    >
      {children}
    </span>
  );
}

function Avatar({
  initial,
  tone,
  inline,
}: {
  initial: string;
  tone: 'one' | 'two' | 'brand';
  inline?: boolean;
}) {
  return (
    <span
      className={cn(
        'grid place-items-center rounded-full border-surface-raised font-sans font-bold text-action-fg',
        inline ? 'h-3.5 w-3.5 border text-[7px]' : '-ml-1.5 h-[19px] w-[19px] border-2 text-[9px]',
        tone === 'one' && 'bg-status-running',
        tone === 'two' && 'bg-status-merged',
        tone === 'brand' && 'bg-action-bg'
      )}
    >
      {initial}
    </span>
  );
}

function SideLabel({ children, first }: { children: string; first?: boolean }) {
  return (
    <p
      className={cn(
        'mb-1 text-[9px] uppercase tracking-[.12em] text-text-passive',
        first ? 'mt-0' : 'mt-3'
      )}
    >
      {children}
    </p>
  );
}

function Row({
  name,
  diff,
  dot,
  active,
  sub,
}: {
  name: string;
  diff?: string;
  dot?: 'running' | 'review' | 'idle';
  active?: boolean;
  sub?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-[3px]',
        active && 'bg-surface-inset',
        sub && 'pl-5 text-[10px] text-text-passive'
      )}
    >
      {dot && (
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            dot === 'running' && 'bg-status-running',
            dot === 'review' && 'bg-action-bg',
            dot === 'idle' && 'bg-text-passive'
          )}
        />
      )}
      <span className="overflow-hidden text-ellipsis">{name}</span>
      {diff && <span className="ml-auto text-[9px] tabular-nums text-text-passive">{diff}</span>}
    </div>
  );
}

function Tab({ children, active }: { children: string; active?: boolean }) {
  return (
    <span
      className={cn(
        'rounded-t px-2.5 py-1 text-[10px]',
        active ? 'bg-surface-inset text-text' : 'text-text-passive'
      )}
    >
      {children}
    </span>
  );
}

function FileRow({ name, diff }: { name: string; diff: string }) {
  return (
    <div className="flex justify-between gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[10px]">
      <span className="overflow-hidden text-ellipsis">{name}</span>
      <span className="text-[9px] tabular-nums text-text-passive">{diff}</span>
    </div>
  );
}

function CheckRow({ name, time }: { name: string; time: string }) {
  return (
    <div className="flex justify-between gap-1.5 whitespace-nowrap px-1.5 py-0.5 text-[10px]">
      <span>{name}</span>
      <span className="text-text tabular-nums">{time}</span>
    </div>
  );
}
