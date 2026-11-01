/* global document -- page.evaluate callbacks run inside the app window */
import { runTranscriptExperienceCheck } from '../experience/transcript-experience.mjs';

/**
 * Check 7e (user report, 2026-10-02): a message the owner addresses only to a
 * teammate is a message to that teammate. Their agent must not answer it: it
 * used to, with "Not addressed to me — no action." under every one, which is
 * noise a person has to read past. The agent reads such messages as context
 * on its next turn instead (thread digest).
 *
 * Read off the owner's transcript, which is what the owner sees: every row
 * after the message, once the agent has had QUIET_MS to answer, which it
 * did well within under the old behaviour. The row is found by its unique
 * marker, so 7f can say whether the words arrived in the order typed (they
 * came out scrambled after a picked mention, e.g. "you review the card? <n> can").
 */
const QUIET_MS = 45_000;

export async function runOwnerMentionReplyCheck({ author, mention, results, shot }) {
  const { check } = results;
  const page = author.instance.page;
  const remaining = mention.sentAt + QUIET_MS - Date.now();
  if (remaining > 0) await page.waitForTimeout(remaining);

  const seen = await page.evaluate((marker) => {
    const rows = [...document.querySelectorAll('[data-testid="chat-transcript"] [data-index]')];
    const index = rows.findIndex((row) => row.textContent?.includes(marker));
    if (index === -1) return null;
    const own = Number(rows[index].getAttribute('data-index'));
    return {
      sent: (rows[index].textContent ?? '').trim(),
      after: rows
        .filter((row) => Number(row.getAttribute('data-index')) > own)
        .map((row) => ({
          message: row.hasAttribute('data-entry-id'),
          text: (row.textContent ?? '').trim().slice(0, 160),
        })),
    };
  }, mention.marker);
  await shot(author, 'mention-no-agent-reply');

  const agentRows = (seen?.after ?? []).filter((row) => !row.message && row.text);
  check(
    '7e  the owner’s agent does not answer a message addressed to the teammate',
    seen !== null && agentRows.length === 0,
    seen === null ? 'the message is not in the owner’s transcript' : JSON.stringify(agentRows)
  );
  check(
    '7f  …and the message reads as the owner typed it',
    seen !== null && seen.sent.includes(mention.text),
    JSON.stringify({ typed: mention.text, shown: seen?.sent ?? null })
  );
  await runTranscriptExperienceCheck({
    id: '7g',
    account: author,
    who: 'the owner',
    typed: [mention.text],
    results,
  });
}
