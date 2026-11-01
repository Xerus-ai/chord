import { formatClaudeDefinitions } from '@shared/claude-definitions-text';
import { formatRunScriptTitle, pairRunScripts } from '@shared/run-scripts';
import { buildClaudeProjectGate } from '@main/core/claude-sdk/claude-project-gate';
import type { BundleContent } from './executable-bundle';

/**
 * The page the script-approval window shows, in Chord's theme: the design
 * tokens come from the sheet generated from the renderer's index.css
 * (out/artifact-runtime/tokens.css), and every colour below is one of them.
 *
 * The page carries no script at all — its CSP allows none — so nothing in it
 * can answer for the user. Each answer is a link to `TRUST_ANSWER_URL`; the
 * window cancels that navigation in `will-navigate` (before any request) and
 * reads the answer from it. The "Always trust" box needs no script either: a
 * `:checked` rule swaps which of the two Run links is shown.
 */

export type TrustAnswer = 'decline' | 'run' | 'run-always';

/** Under the reserved `.invalid` TLD (RFC 2606): never resolves, and is never requested. */
const TRUST_ANSWER_URL = 'https://trust-prompt.invalid/answer/';

const ANSWERS: readonly TrustAnswer[] = ['decline', 'run', 'run-always'];

/** The answer a link of the prompt names, or null for any other URL. */
export function readTrustAnswer(url: string): TrustAnswer | null {
  return ANSWERS.find((answer) => url === `${TRUST_ANSWER_URL}${answer}`) ?? null;
}

export type TrustPromptTheme = 'dark' | 'light';

export interface TrustPromptContent {
  repoPath: string;
  ref: string;
  bundle: BundleContent;
  /** What was last approved with Always trust, to mark what changed; null if nothing was. */
  previous: BundleContent | null;
  /** False where Chord does not run `shellSetup` (Windows). */
  shellSetupRuns: boolean;
  /**
   * The lane is a checkout the user made and Chord adopted: setup runs only
   * when they press Run setup, in that folder, and no teardown runs
   * (devstation-1zm).
   */
  adoptedCheckout: boolean;
}

interface Item {
  title: string;
  when: string;
  now: string;
  before: string | undefined;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function items(
  bundle: BundleContent,
  previous: BundleContent | null,
  shellSetupRuns: boolean,
  adoptedCheckout: boolean
): Item[] {
  const { chord, claude } = bundle;
  const list: Array<Omit<Item, 'now'> & { now: string | undefined }> = [
    {
      title: 'Setup script',
      when: adoptedCheckout ? 'Runs in this checkout, now.' : 'Runs in each new lane.',
      now: chord.setup,
      before: previous?.chord.setup,
    },
    {
      title: 'Shell setup',
      when: shellSetupRuns
        ? 'Runs before each agent and terminal starts.'
        : 'Is not run on Windows; shown for completeness.',
      now: chord.shellSetup,
      before: previous?.chord.shellSetup,
    },
    // One item per run script, so each named one shows (and diffs) on its own.
    ...pairRunScripts(chord.run, previous?.chord.run).map((pair) => ({
      title: formatRunScriptTitle(pair.id),
      when: 'Runs when you start it.',
      now: pair.now,
      before: pair.before,
    })),
    {
      title: 'Test script',
      when: 'Runs when you press Test.',
      now: chord.test,
      before: previous?.chord.test,
    },
    {
      title: 'Teardown script',
      when: adoptedCheckout
        ? 'Never runs here: Chord does not remove a checkout it adopted.'
        : 'Runs when a lane is removed.',
      now: chord.teardown,
      before: previous?.chord.teardown,
    },
    {
      title: 'Claude hooks and settings',
      when: 'From .claude/settings.json: run or allowed by Claude Code in this checkout.',
      now: claude.settings && json(claude.settings),
      before: previous?.claude.settings && json(previous.claude.settings),
    },
    {
      title: 'Claude local settings (committed)',
      when: 'From .claude/settings.local.json, which this repository commits.',
      now: claude.localSettings && json(claude.localSettings),
      before: previous?.claude.localSettings && json(previous.claude.localSettings),
    },
    {
      title: 'MCP servers',
      when: 'From .mcp.json: started by Claude Code in this checkout.',
      now: claude.mcpServers && json(claude.mcpServers),
      before: previous?.claude.mcpServers && json(previous.claude.mcpServers),
    },
    {
      title: 'Claude skills, agents and commands',
      when: 'From .claude/skills, agents and commands: hooks, servers and tool grants in their headers run once one is used, and ! shell lines run when it is invoked.',
      now: claude.definitions && formatClaudeDefinitions(claude.definitions),
      before: previous?.claude.definitions && formatClaudeDefinitions(previous.claude.definitions),
    },
  ];
  return list.filter((item): item is Item => item.now !== undefined);
}

const PAGE_CSS = `
html, body { margin: 0; height: 100%; }
body {
  display: flex; flex-direction: column;
  background: var(--surface-canvas); color: var(--text);
  font-family: var(--font-sans); font-size: 13px; line-height: 1.5;
}
main {
  flex: 1; min-height: 0; overflow: auto; padding: 16px 20px;
  display: flex; flex-direction: column; gap: 12px;
}
h1 { margin: 0; font-size: 15px; font-weight: 600; }
h2 { margin: 0; font-size: 13px; font-weight: 600; }
.repo { margin: 0; font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); word-break: break-all; }
.source, .when, .note, .label { margin: 0; color: var(--text-muted); }
code { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
.item { display: flex; flex-direction: column; gap: 4px; }
.item.changed h2::after { content: ' — changed'; color: var(--status-warn); font-weight: 400; }
pre {
  margin: 0; padding: 8px 12px;
  background: var(--surface-inset); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-family: var(--font-mono); font-size: 12px; line-height: 1.55; overflow: auto;
  white-space: pre-wrap; word-break: break-word;
}
pre.before { color: var(--status-err); background: var(--status-err-bg); }
pre.now-changed { color: var(--status-ok); background: var(--status-ok-bg); }
#always { position: absolute; opacity: 0; pointer-events: none; }
footer {
  flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 20px;
  background: var(--surface); border-top: 1px solid var(--border-subtle);
}
footer label { margin-right: auto; display: flex; align-items: center; gap: 8px; color: var(--text-muted); cursor: default; }
.box {
  width: 14px; height: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--surface-raised); display: inline-flex; align-items: center; justify-content: center;
}
#always:checked ~ footer .box { background: var(--action-bg); border-color: transparent; }
#always:checked ~ footer .box::after { content: '✓'; color: var(--action-fg); font-size: 10px; }
#always:focus-visible ~ footer .box { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.answer {
  display: inline-block; padding: 6px 14px; cursor: default; text-decoration: none;
  color: var(--text); background: var(--surface-raised);
  border: 1px solid var(--border); border-radius: var(--radius-md);
}
.answer:hover { background: var(--surface-hover); }
.answer:focus { outline: none; }
.answer:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
.answer.grant { color: var(--action-fg); background: var(--action-bg); border-color: transparent; }
.answer.grant:hover { background: var(--action-bg-hover); }
.run-always { display: none; }
#always:checked ~ footer .run-once { display: none; }
#always:checked ~ footer .run-always { display: inline-block; }
`;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderItem(item: Item, compare: boolean): string {
  const changed = compare && item.before !== item.now;
  const before =
    changed && item.before !== undefined
      ? `<p class="label">Before</p><pre class="before">${escapeHtml(item.before)}</pre><p class="label">Now</p>`
      : '';
  const now = `<pre${changed ? ' class="now-changed"' : ''}>${escapeHtml(item.now)}</pre>`;
  return `<section class="item${changed ? ' changed' : ''}">
<h2>${escapeHtml(item.title)}</h2>
<p class="when">${escapeHtml(item.when)}</p>
${before}${now}
</section>`;
}

function answerLink(answer: TrustAnswer, label: string, className: string, extra = ''): string {
  return `<a class="answer${className ? ` ${className}` : ''}" href="${TRUST_ANSWER_URL}${answer}"${extra}>${label}</a>`;
}

export function renderTrustPromptPage(
  args: TrustPromptContent & { theme: TrustPromptTheme; tokenSheet: string }
): string {
  if (/<\/style/i.test(args.tokenSheet)) {
    throw new Error('The token sheet contains "</style" and cannot be inlined');
  }
  const list = items(args.bundle, args.previous, args.shellSetupRuns, args.adoptedCheckout);
  const compare = args.previous !== null;
  const anyChanged = compare && list.some((item) => item.before !== item.now);
  const heading = anyChanged
    ? 'Scripts from this repository changed since you last trusted them'
    : 'Run scripts from this repository?';
  const { claude } = args.bundle;
  // What Don't run does to a chat is what the chat's gate does — asked of it.
  const dropsGuidance = buildClaudeProjectGate({ claude, approved: false }).dropsProjectGuidance;
  const claudeNote =
    Object.keys(claude).length === 0
      ? ''
      : `<p class="note">Running them also marks this checkout as trusted in Claude Code, so its hooks and MCP servers load. ${
          dropsGuidance
            ? escapeHtml(
                "If you choose Don't run, chats here start without this repository's CLAUDE.md and Claude settings: its hooks, env and helper settings can't be separated from them. Your own Claude settings and hooks still apply."
              )
            : escapeHtml(
                "Don't run keeps its hooks and MCP servers off; CLAUDE.md and other guidance still load."
              )
        }</p>`;
  // "Don't run" comes first and holds the focus, so Enter runs nothing.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Run scripts?</title>
<style>${args.tokenSheet}
${PAGE_CSS}</style>
</head>
<body class="chord-${args.theme}">
<main>
<h1>${escapeHtml(heading)}</h1>
<p class="repo">${escapeHtml(args.repoPath)}</p>
<p class="source">From <code>.chord.json</code> at <code>${escapeHtml(args.ref)}</code> and this checkout's Claude config. Only run code from authors you trust; the lane opens either way.</p>
${list.map((item) => renderItem(item, compare)).join('\n')}
${claudeNote}
</main>
<input type="checkbox" id="always">
<footer>
<label for="always"><span class="box"></span>Always trust scripts from this repository</label>
${answerLink('decline', 'Don&#39;t run', '', ' autofocus')}
${answerLink('run', 'Run scripts', 'grant run-once')}
${answerLink('run-always', 'Run scripts', 'grant run-always')}
</footer>
</body>
</html>`;
}
