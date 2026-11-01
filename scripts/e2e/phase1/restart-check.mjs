/**
 * Phase 1 check 8: two chats in one work item survive a restart, each
 * resuming its own conversation. The app is closed with its profile kept and
 * launched again on it, as quitting and reopening Chord would.
 */
import { basename } from 'node:path';
import {
  createWorkItem,
  listChats,
  openChat,
  replyText,
  runTurn,
} from '../history/history-chat.mjs';
import { launchAccount } from '../sharing/sharing-accounts.mjs';

const CODEWORDS = ['ALPHA-7', 'BRAVO-3'];
const ASK = 'What codeword did I give you? Reply with only the codeword.';
const rememberPrompt = (codeword) => `Remember the codeword ${codeword}. Reply with only OK.`;

/** Replaces `ctx.account` with the relaunched app's account. */
export async function checkTwoChatsSurviveRestart(ctx, repo, seedProfile) {
  const { r } = ctx;
  const name = `Phase 1 restart ${Date.now()}`;
  const { workItem } = await createWorkItem(ctx.account, repo.repoId, name);
  ctx.created.push(workItem.id);
  const chats = [];
  for (const codeword of CODEWORDS) {
    const { session } = await ctx.account.call('agentSessions.create', {
      workItemId: workItem.id,
      kind: 'chat',
      agentProviderId: 'codex',
      communication: 'acp',
    });
    const chat = { workItemId: workItem.id, sessionId: session.id, providerId: 'codex' };
    await runTurn(ctx.account, chat, rememberPrompt(codeword));
    chats.push({ codeword, chat });
  }
  // devstation-d8lx: a chat opened untitled takes its first message as title,
  // so the two read apart instead of both "Codex".
  const titled = await listChats(ctx.account, workItem.id);
  const titles = chats.map(({ chat }) => titled.find((row) => row.id === chat.sessionId)?.title);
  r.check(
    'Two chats opened untitled are titled by their first messages',
    titles.every((title, index) => title === rememberPrompt(CODEWORDS[index])),
    titles.map((title) => `"${title}"`).join(', ')
  );

  const profile = basename(ctx.account.instance.profileDir);
  await ctx.account.close({ keepProfile: true });
  ctx.account = await launchAccount({ seedProfile, label: 'phase1', reopenProfile: profile });
  ctx.page = ctx.account.instance.page;

  const answers = [];
  for (const { codeword, chat } of chats) {
    const reply = replyText(await runTurn(ctx.account, chat, ASK));
    answers.push({ codeword, reply });
  }
  r.check(
    'Two chats in one item survive a restart, each resuming its own conversation',
    answers.every(
      ({ codeword, reply }) =>
        reply.includes(codeword) &&
        CODEWORDS.every((other) => other === codeword || !reply.includes(other))
    ),
    answers.map(({ codeword, reply }) => `${codeword} chat answered "${reply.trim()}"`).join('; ')
  );

  // The reply alone, as shown: other chats' transcripts stay mounted, hidden.
  const shownReply = (codeword) =>
    ctx.page.getByText(codeword, { exact: true }).filter({ visible: true }).first();
  await openChat(ctx.page, name, chats[0].chat.sessionId);
  await shownReply(CODEWORDS[0]).waitFor({ timeout: 30_000 });
  await ctx.page.screenshot({ path: r.shot('restart-chat-a') });
  await openChat(ctx.page, name, chats[1].chat.sessionId);
  await shownReply(CODEWORDS[1]).waitFor({ timeout: 30_000 });
  await ctx.page.screenshot({ path: r.shot('restart-chat-b') });
}
