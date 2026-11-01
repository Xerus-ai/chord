/* global document -- page.evaluate callbacks run inside the app window */
/**
 * What a person sees in a chat, checked as they would see it. Mechanical
 * checks can all pass while the transcript reads badly: on 2026-10-02 every
 * sharing check passed while the owner's chat filled with the agent's "Not
 * addressed to me — no action." and with messages whose words came out of
 * order. Call this wherever a suite has a chat open, on every app in the run.
 *
 * It reads the whole transcript (scrolling it, since it renders only what is
 * on screen, then putting the scroll back) and fails on:
 *   - agent rows that only say the agent was not meant (NOISE);
 *   - raw errors shown to the user (RAW_ERROR);
 *   - a message the suite typed that is not shown exactly as typed;
 *   - the same message shown twice in a row;
 *   - an agent reply that repeats its own paragraph (a turn answered twice).
 * Add a pattern here whenever a run shows a new kind of bad experience.
 */

const NOISE = [
  /not addressed to (me|you)/i,
  /\bno action\b/i,
  /\bI['’]ll leave this (one )?(to|for)\b/i,
  /\bnot (meant|directed|intended) for me\b/i,
  // The agent narrating a publish decision nobody asked about (devstation-fo4u):
  // "not a deliverable, so I'm not publishing it", "no artifact to publish".
  /\b(not publishing|won['’]t publish|nothing to publish|no artifact to publish)\b/i,
  /\bnot (a |an )?(team )?deliverable\b/i,
];

const RAW_ERROR = [
  /\[object Object\]/,
  /\bundefined\b(?! is| was)/,
  /\bNaN\b/,
  /\bat \S+ \(\S+:\d+:\d+\)/,
  /\b(TypeError|ReferenceError|SyntaxError):/,
  /\bTraceback \(most recent call last\)/,
];

/** Every row of every transcript on the page, in order: `{ message, text, paragraphs }`. */
async function readTranscripts(page) {
  return page.evaluate(async () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
    const out = [];
    for (const box of document.querySelectorAll('[data-testid="chat-transcript"]')) {
      const saved = box.scrollTop;
      const rows = new Map();
      const collect = () => {
        for (const el of box.querySelectorAll('[data-index]')) {
          rows.set(Number(el.getAttribute('data-index')), {
            message: el.hasAttribute('data-entry-id'),
            text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
            paragraphs: [...el.querySelectorAll('p')].map((p) =>
              (p.textContent ?? '').replace(/\s+/g, ' ').trim()
            ),
          });
        }
      };
      box.scrollTop = 0;
      await settle();
      for (let step = 0; step < 500; step++) {
        collect();
        if (box.scrollTop + box.clientHeight >= box.scrollHeight - 2) break;
        box.scrollTop += Math.max(box.clientHeight * 0.8, 40);
        await settle();
      }
      collect();
      box.scrollTop = saved;
      out.push([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row));
    }
    return out;
  });
}

/** The problems a person would see in these rows; empty when it reads well. */
export function findTranscriptProblems(rows, typed) {
  const problems = [];
  for (const row of rows) {
    if (!row.message && NOISE.some((p) => p.test(row.text))) {
      problems.push(`agent noise: "${row.text.slice(0, 80)}"`);
    }
    if (RAW_ERROR.some((p) => p.test(row.text))) {
      problems.push(`raw error shown: "${row.text.slice(0, 80)}"`);
    }
    // devstation-fo4u: a Stop-hook continuation answered the turn again ("OK", "OK").
    const paragraphs = (row.paragraphs ?? []).filter(Boolean);
    for (let i = 1; !row.message && i < paragraphs.length; i++) {
      if (paragraphs[i] === paragraphs[i - 1]) {
        problems.push(`reply repeated: "${paragraphs[i].slice(0, 80)}"`);
        break;
      }
    }
  }
  const messages = rows.filter((row) => row.message).map((row) => row.text);
  for (const text of typed) {
    if (!messages.some((shown) => shown.includes(text))) {
      problems.push(`not shown as typed: "${text}"`);
    }
  }
  for (let i = 1; i < messages.length; i++) {
    if (messages[i] === messages[i - 1]) {
      problems.push(`shown twice: "${messages[i].slice(0, 80)}"`);
    }
  }
  return problems;
}

/**
 * One check per app: `typed` lists what the suite typed into a chat this app
 * shows, exactly as typed; leave it empty for an app that only reads.
 */
export async function runTranscriptExperienceCheck({ id, account, who, typed = [], results }) {
  const transcripts = await readTranscripts(account.instance.page);
  const rows = transcripts.flat();
  const problems =
    transcripts.length === 0 ? ['no chat transcript is open'] : findTranscriptProblems(rows, typed);
  results.check(
    `${id}  ${who}’s chat reads well: no agent noise, no raw errors, messages as typed`,
    problems.length === 0,
    problems.length ? problems.join('; ') : `${rows.length} rows`
  );
}
