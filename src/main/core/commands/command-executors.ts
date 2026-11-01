import type { CloudCommand, CloudPermissionOption } from '@chord/protocol';
import { eq } from 'drizzle-orm';
import { getAcpConnection } from '@main/core/acp/acp-session-store';
import { respondToWorkItemPermission } from '@main/core/acp/respond-to-permission';
import { respondToWorkItemPlan } from '@main/core/acp/respond-to-plan';
import { buildThreadDigest } from '@main/core/chat-messages/thread-digest';
import { validateTargetSession } from '@main/core/chat-messages/validate-target-session';
import { getActiveSessions } from '@main/core/work-items/active-sessions';
import { sendInput } from '@main/core/work-items/session-service';
import { db } from '@main/db/client';
import { commandLedger } from '@main/db/schema-sync';
import { agentSessions } from '@main/db/schema-work-items';
import { log } from '@main/lib/logger';
import { permissionPublicationService } from './permission-publication-service';
import { planPublicationService } from './plan-publication-service';
import { selectCommandTargetSession } from './select-command-target-session';
import { stripControlCharacters } from './strip-control-characters';

/**
 * What each command kind does once the inbox (command-inbox-service.ts) has
 * claimed it. The inbox owns delivery — fetch, claim, ledger, ack; these own
 * execution, and report a delivery that cannot execute by throwing
 * CommandExecutionError.
 */

// Thrown by kind executors for a delivery that reached the device fine but
// cannot execute — acked 'failed' with the reason, never retried locally.
export class CommandExecutionError extends Error {}

/**
 * Maps a `permission_response` command's choice back to the agent's own
 * option. The wire enum names a KIND ('allow_once' | 'allow_always' |
 * 'reject_once'); ACP agents use arbitrary optionIds, so kind is tried first
 * and the raw optionId second.
 *
 * The 'reject_once' fold is the mirror of permission-publication-service's
 * toCloudResolution: 'reject_always' has no wire representation, so the
 * participant card publishes a reject_always-only request's Deny button as
 * 'reject_once'. Without folding it back here, that Deny finds no option and
 * acks 'failed' — the deny never reaches the agent.
 */
function findAnsweredOption(
  options: CloudPermissionOption[],
  optionKind: string
): CloudPermissionOption | undefined {
  return (
    options.find((o) => o.kind === optionKind) ??
    options.find((o) => o.optionId === optionKind) ??
    (optionKind === 'reject_once' ? options.find((o) => o.kind === 'reject_always') : undefined)
  );
}

/**
 * Delivers a teammate's prompt into the thread they typed it in
 * (`command.session_id`), via the same sendInput the owner-typed path uses,
 * prefixed with that thread's digest
 * (thread-digest.ts) — same injection as owner-typed prompts, so the agent
 * sees anything it missed regardless of who woke it. The prompt's chat row
 * already exists in the cloud (inserted atomically with the command);
 * ingestion brings it down — its id is excluded from the digest (and its
 * metadata.agent_prompt keeps it out of future ones): the prompt IS the
 * delivery. No live target session → park: ledger 'parked', cloud row stays
 * claimed, the session-start kick re-drains, and the digest is rebuilt at
 * flush time (the cursor only advances on an actual send). That covers both
 * "nothing is running" and "the named thread is not running", which is why
 * a named thread never falls back to another one.
 */
export function executePrompt(
  command: CloudCommand,
  alreadyParked: boolean
): 'executed' | 'parked' {
  assertIssuerMayDriveAgent(command);
  const rawContent = command.payload.content;
  if (typeof rawContent !== 'string' || rawContent.length === 0) {
    throw new CommandExecutionError('invalid prompt payload');
  }
  // A teammate's prompt is text, not keystrokes: strip control characters
  // (keeping newline and tab) so escape sequences and carriage returns can
  // never drive the PTY, regardless of what an older server let through.
  const content = stripControlCharacters(rawContent);
  if (content.length === 0) {
    throw new CommandExecutionError('invalid prompt payload');
  }
  const chatMessageId = command.payload.chat_message_id;

  // The thread the teammate actually typed in. Parking is only right for a
  // thread that can still come back: a `prompt` command never expires
  // (routes/commands.ts), so parking one addressed to an ended session leaks
  // it forever and the teammate is never told. Validate the named session
  // against the same guard the owner-typed path uses and fail loudly.
  assertNamedSessionCanReceive(command);
  const chatSession = selectCommandTargetSession(
    getActiveSessions(command.work_item_id),
    command.session_id
  );
  let sent = false;
  if (chatSession) {
    // A slash command only executes when it STARTS the delivered message —
    // never digest-wrap it (same rule as the owner-typed path). Its chat
    // row is already agent_prompt-marked server-side, so skipping the
    // cursor commit cannot replay it into a later digest.
    const isSlashCommand = /^\/[A-Za-z0-9]/.test(content.trim());
    if (isSlashCommand) {
      sent = sendInput(chatSession.sessionId, content);
    } else {
      const digest = buildThreadDigest(
        command.work_item_id,
        chatSession.sessionId,
        typeof chatMessageId === 'string' ? [chatMessageId] : []
      );
      sent = sendInput(chatSession.sessionId, digest.wrap(content));
      if (sent) digest.commit();
    }
  }
  if (sent) return 'executed';

  if (!alreadyParked) {
    db.insert(commandLedger)
      .values({
        commandId: command.id,
        workItemId: command.work_item_id,
        kind: command.kind,
        state: 'parked',
      })
      .onConflictDoNothing()
      .run();
    log.info(`[commands] parked prompt ${command.id} for ${command.work_item_id}`);
  }
  return 'parked';
}

/**
 * The issuer's policy re-validated against the FETCH-TIME snapshot the
 * device surface embeds, not the insert-time gate alone: the owner may
 * have flipped approval_policy back to 'owner' between issue and delivery.
 * Applies to EVERY kind — a prompt or interrupt drives the owner's agent
 * exactly as much as an approval response does.
 */
function assertIssuerMayDriveAgent(command: CloudCommand): void {
  const creatorId = command.work_item_creator_id;
  const policy = command.work_item_approval_policy;
  if (!creatorId || !policy) {
    // A fetch row without the policy snapshot is a version-skewed or
    // forged surface — fail closed, never guess.
    throw new CommandExecutionError('missing approval-policy metadata');
  }
  if (command.issuer_id !== creatorId && policy !== 'participants') {
    throw new CommandExecutionError('approval policy restricts commands to the owner');
  }
}

/**
 * A teammate's Allow/Deny, delivered (design §4): fans into the SAME
 * respondToPermission path the owner's click uses, so the resolution tap
 * (stream item + cloud retraction, attributed to the issuer) fires
 * identically. Owner veto is structural — a request the owner already
 * answered is settled in the published ledger and this acks
 * 'failed: already resolved' without touching the session. The issuer's
 * policy is re-validated against the FETCH-TIME snapshot the device
 * surface embeds, not the insert-time gate alone: the owner may have
 * flipped approval_policy back to 'owner' between issue and delivery.
 */
export async function executePermissionResponse(command: CloudCommand): Promise<void> {
  const requestId = command.payload.request_id;
  const optionKind = command.payload.option_id;
  if (typeof requestId !== 'string' || typeof optionKind !== 'string') {
    throw new CommandExecutionError('invalid permission_response payload');
  }

  assertIssuerMayDriveAgent(command);

  const published = permissionPublicationService.getPublishedRequest(requestId);
  if (!published) {
    throw new CommandExecutionError('unknown permission request');
  }
  if (published.status !== 'pending') {
    throw new CommandExecutionError('already resolved');
  }

  const option = findAnsweredOption(published.options, optionKind);
  if (!option) {
    throw new CommandExecutionError(`option ${optionKind} is not available on this request`);
  }

  const outcome = await respondToWorkItemPermission(
    command.work_item_id,
    requestId,
    option.optionId,
    command.issuer_id
  );
  if (!outcome.ok) {
    throw new CommandExecutionError(
      outcome.reason === 'no_session' ? 'agent not running' : outcome.message
    );
  }
}

/**
 * Rejects a command naming a session that can never receive it — unknown,
 * belonging to another work item, a terminal, or ended. Reuses the owner
 * path's guard (`validate-target-session.ts`) so a teammate and the owner
 * get the same answer about the same session.
 *
 * A session that merely is not running right now is NOT rejected: suspended
 * conversations are resumable, and parking until they resume is the point.
 */
function assertNamedSessionCanReceive(command: CloudCommand): void {
  const sessionId = command.session_id;
  if (!sessionId) return;
  const [row] = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .limit(1)
    .all();
  const validated = validateTargetSession(row, command.work_item_id);
  if (!validated.success) throw new CommandExecutionError(validated.error.message);
}

export async function executePlanResponse(command: CloudCommand): Promise<void> {
  const requestId = command.payload.request_id;
  const action = command.payload.action;
  if (typeof requestId !== 'string' || (action !== 'approve' && action !== 'reject')) {
    throw new CommandExecutionError('invalid plan_response payload');
  }

  assertIssuerMayDriveAgent(command);

  const published = planPublicationService.getPublishedRequest(requestId);
  if (!published) throw new CommandExecutionError('unknown plan request');
  if (published.status !== 'pending') throw new CommandExecutionError('already resolved');

  const outcome = await respondToWorkItemPlan(
    command.work_item_id,
    requestId,
    action as 'approve' | 'reject',
    undefined,
    command.issuer_id
  );
  if (!outcome.ok) {
    throw new CommandExecutionError(
      outcome.reason === 'no_session' ? 'agent not running' : outcome.message
    );
  }
}

/**
 * The same targets the renderer's stop button reaches: every active chat
 * session on the work item — a structured session (Claude, Codex) handles
 * interrupt in-process, ACP cancels over the connection. No session at all is a FAILED delivery
 * (interrupt has nothing to park against, by design).
 */
export function executeInterrupt(command: CloudCommand): void {
  assertIssuerMayDriveAgent(command);
  assertNamedSessionCanReceive(command);
  // Stop belongs to the thread it was pressed in. Interrupting every chat
  // session would let a teammate's Stop in one thread kill another agent's
  // turn — invisible with one session, wrong the moment there are two.
  const named = command.session_id;
  const chatSessions = getActiveSessions(command.work_item_id).filter(
    (s) => s.kind === 'chat' && (!named || s.sessionId === named)
  );
  let interrupted = 0;

  for (const session of chatSessions) {
    if (session.chatHandle) {
      void session.chatHandle.interrupt().catch((e: unknown) => {
        log.warn(`[commands] interrupt of ${session.sessionId} failed:`, e);
      });
      interrupted += 1;
    } else if (session.mode === 'acp') {
      const connection = getAcpConnection(session.sessionId);
      if (connection) {
        void connection.cancel().catch((e: unknown) => {
          log.warn(`[commands] cancel of ${session.sessionId} failed:`, e);
        });
        interrupted += 1;
      }
    }
  }

  if (interrupted === 0) {
    throw new CommandExecutionError('agent not running');
  }
}
