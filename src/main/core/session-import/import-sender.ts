import { chordAccountService } from '@main/core/account/services/chord-account-service';
import type { ImportAgentSessionArgs } from './import-agent-session';

/**
 * Who typed an imported session's prompts: the signed-in user of this machine,
 * attributed like any chat this user sends (`insert-chat-message-row.ts`).
 */
export async function resolveImportSender(): Promise<ImportAgentSessionArgs['sender']> {
  const account = await chordAccountService.getSession();
  return { id: account.user?.userId ?? null, name: account.user?.username ?? 'User' };
}
