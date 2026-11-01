import type { CloudCommand } from '@chord/protocol';
import { eq } from 'drizzle-orm';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import { db } from '@main/db/client';
import { commandLedger } from '@main/db/schema-sync';
import { workItems } from '@main/db/schema-work-items';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { ackCommand, claimCommand, fetchCommands, getDeviceId } from './cloud-commands-client';
import {
  CommandExecutionError,
  executeInterrupt,
  executePermissionResponse,
  executePlanResponse,
  executePrompt,
} from './command-executors';

// The sync-queue's cadence, inverted: fetch on doorbell (kick), on device
// socket (re)connect, and on this interval as the belt-and-braces floor.
const FETCH_INTERVAL_MS = 30_000;
const KICK_DELAY_MS = 500;

/**
 * The inbound half of the command channel — the sync-queue's reliability
 * story pointed the other way: fetch → claim → execute → ack, with the
 * command_ledger making at-least-once redelivery safe (a command already
 * 'executed' in the ledger is re-acked, never re-executed). Commands run
 * strictly in ascending-id order (uuidv7 = issue order), one at a time, so
 * per-work-item ordering holds. Design doc §3.
 *
 * Kinds: `interrupt`, `prompt`, `permission_response` and `plan_response`
 * execute in command-executors.ts.
 * Truly unknown kinds are claimed and acked 'failed' — never executed.
 *
 * Parking: a prompt with no active chat session stays CLAIMED in the cloud
 * with a 'parked' ledger row here. session-service kicks this service when
 * a chat session starts; the next drain refetches the claimed-unacked rows
 * (payload included) and delivers them in id order. No local payload copy —
 * the cloud row is the durable store either way.
 */
class CommandInboxService implements IInitializable, IDisposable {
  private timer: ReturnType<typeof setInterval> | null = null;
  private kickTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;
  private pendingKick = false;

  initialize(): void {
    this.timer = setInterval(() => void this.process(), FETCH_INTERVAL_MS);
    void this.process();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.timer = null;
    this.kickTimer = null;
  }

  /** Doorbell/debounce entry — device socket frames and reconnects land here. */
  kick(): void {
    if (this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.process();
    }, KICK_DELAY_MS);
  }

  private async process(): Promise<void> {
    if (this.processing) {
      // A doorbell during a drain means new rows we haven't fetched — run
      // one more pass when this one finishes rather than dropping the ping.
      this.pendingKick = true;
      return;
    }
    this.processing = true;
    try {
      await this.drain();
    } catch (e) {
      // Network/auth failures defer to the next interval tick — the cloud
      // rows are durable and redelivery is the recovery mechanism.
      log.warn('[commands] inbox drain failed:', e instanceof Error ? e.message : e);
    } finally {
      this.processing = false;
      if (this.pendingKick) {
        this.pendingKick = false;
        void this.process();
      }
    }
  }

  private async drain(): Promise<void> {
    const session = await chordAccountService.getSession();
    if (session.authState !== 'signed_in') return;

    const localIds = db
      .select({ id: workItems.id })
      .from(workItems)
      .all()
      .map((r) => r.id);
    if (localIds.length === 0) return;

    const deviceId = await getDeviceId();
    const commands = await fetchCommands(deviceId, localIds);

    for (const command of commands) {
      await this.handleCommand(command, deviceId);
    }
  }

  private async handleCommand(command: CloudCommand, deviceId: string): Promise<void> {
    // Dedup BEFORE claiming: an executed command whose ack was lost comes
    // back on the next fetch already claimed by us — settle it, never rerun.
    const [ledgerRow] = db
      .select()
      .from(commandLedger)
      .where(eq(commandLedger.commandId, command.id))
      .limit(1)
      .all();
    if (ledgerRow?.state === 'executed') {
      await ackCommand(command.id, deviceId, 'acked');
      return;
    }

    const claimed =
      command.status === 'claimed' && command.claimed_by_device === deviceId
        ? command
        : await claimCommand(command.id, deviceId);
    if (!claimed) return; // another device won, or the row expired

    let outcome: 'executed' | 'parked';
    try {
      if (command.kind === 'interrupt') {
        executeInterrupt(command);
        outcome = 'executed';
      } else if (command.kind === 'prompt') {
        outcome = executePrompt(command, ledgerRow?.state === 'parked');
      } else if (command.kind === 'permission_response') {
        await executePermissionResponse(command);
        outcome = 'executed';
      } else if (command.kind === 'plan_response') {
        await executePlanResponse(command);
        outcome = 'executed';
      } else {
        // Strict allowlist — a kind this build doesn't know is a version
        // skew or a forged row; it fails loudly and never executes.
        throw new CommandExecutionError(`unsupported command kind: ${command.kind}`);
      }
    } catch (e) {
      const reason =
        e instanceof CommandExecutionError ? e.message : `execution error: ${String(e)}`;
      await ackCommand(command.id, deviceId, 'failed', reason);
      return;
    }

    if (outcome === 'parked') return; // claimed, un-acked — flushes on session start

    // Ledger row lands BEFORE the ack: if the ack is lost, redelivery finds
    // 'executed' above and re-acks instead of re-executing — this is what
    // makes at-least-once delivery safe for non-idempotent prompts.
    db.insert(commandLedger)
      .values({
        commandId: command.id,
        workItemId: command.work_item_id,
        kind: command.kind,
        state: 'executed',
        executedAt: Math.floor(Date.now() / 1000),
      })
      .onConflictDoUpdate({
        target: commandLedger.commandId,
        set: { state: 'executed', executedAt: Math.floor(Date.now() / 1000) },
      })
      .run();

    await ackCommand(command.id, deviceId, 'acked');
    log.info(`[commands] executed ${command.kind} ${command.id} for ${command.work_item_id}`);
  }
}

export const commandInboxService = new CommandInboxService();
