import { randomUUID } from 'node:crypto';
import { chatMessageChannel, type ChatMessageEvent } from '@shared/events/chatEvents';
import type { Pty } from '@main/core/pty/pty';
import { syncQueueService } from '@main/core/work-items/sync-queue-service';
import { db } from '@main/db/client';
import { chatMessages } from '@main/db/schema-work-items';
import { events } from '@main/lib/events';
import { stampChatRowTime } from './chat-row-time';
import { toCloudChatBulkMessage } from './chat-wire-mapper';

const FLUSH_IDLE_MS = 500;

function stripPtyAnsi(s: string): string {
  return (
    s
      // CSI sequences including private modes (\x1b[?25h, \x1b[?2004h, etc.)
      .replace(/\x1b\[[\x20-\x3f]*[0-9;]*[\x20-\x3f]*[A-Za-z]/g, '')
      // OSC sequences terminated by BEL (\x07)
      .replace(/\x1b\][^\x07]*\x07/g, '')
      // OSC sequences terminated by ST (\x1b\\)
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')
      // DCS sequences (\x1bP...\x1b\\)
      .replace(/\x1bP[^\x1b]*\x1b\\/g, '')
      // APC sequences (\x1b_...\x1b\\)
      .replace(/\x1b_[^\x1b]*\x1b\\/g, '')
      // Single-character escape sequences (\x1b followed by one char)
      .replace(/\x1b[^[\]P_]/g, '')
      // Carriage returns and other control chars (keep \n)
      .replace(/[\x00-\x09\x0b-\x0c\x0e-\x1f\x7f]/g, '')
  );
}

// Box drawing and block element Unicode ranges used by TUI apps
const BOX_DRAWING_RE = /[─-╿▀-▟←-⇿■-◿✀-➿]/g;

// Lines that are purely decorative (horizontal rules, box borders)
function isDecorativeLine(line: string): boolean {
  const stripped = line.replace(/\s/g, '');
  if (stripped.length === 0) return false;
  const boxChars = stripped
    .replace(BOX_DRAWING_RE, '')
    .replace(/[─│╭╮╰╯├┤┬┴┼═║╔╗╚╝╠╣╦╩╬╌╎▐▛▜▝▘█▌▀▄░▒▓●❯✔]/g, '');
  return boxChars.length / stripped.length < 0.15;
}

// TUI noise patterns from Claude Code startup/menus
const TUI_NOISE_PATTERNS = [
  /Quick safety check/i,
  /Yes, I trust this folder/i,
  /No, exit/i,
  /Enter to confirm/i,
  /Esc to cancel/i,
  /Tips for getting started/i,
  /Welcome back/i,
  /What's new/i,
  /\/release-notes for more/i,
  /\/model to change/i,
  /\/remote-control is active/i,
  /Session ──/i,
  /Weekly ──/i,
  /\/effort/i,
  /Accessing workspace:/i,
  /Security guide/i,
  /Claude Code v\d/i,
  /Claude Code'll be able to/i,
];

function isTuiNoise(text: string): boolean {
  const matchCount = TUI_NOISE_PATTERNS.filter((p) => p.test(text)).length;
  return matchCount >= 2;
}

function cleanPtyOutput(raw: string): string {
  const stripped = stripPtyAnsi(raw);

  const lines = stripped.split('\n');
  const cleaned = lines
    .filter((line) => !isDecorativeLine(line))
    .map((line) =>
      line
        .replace(BOX_DRAWING_RE, '')
        .replace(/[╭╮╰╯│├┤┬┴┼═║╔╗╚╝╠╣╦╩╬╌╎▐▛▜▝▘█▌▀▄░▒▓●❯✔]/g, '')
        .trim()
    )
    .filter((line) => line.length > 0);

  // Collapse runs of 3+ empty-ish lines to one
  const deduped: string[] = [];
  let emptyRun = 0;
  for (const line of cleaned) {
    if (line.length < 3) {
      emptyRun++;
      if (emptyRun <= 1) deduped.push(line);
    } else {
      emptyRun = 0;
      deduped.push(line);
    }
  }

  return deduped.join('\n').trim();
}

class PtyChatBridge {
  private buffer = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private workItemId: string,
    private agentName: string,
    private sessionId: string | null = null
  ) {}

  attach(pty: Pty): void {
    pty.onData((data: string) => {
      if (this.stopped) return;
      this.onData(data);
    });

    pty.onExit(() => {
      this.flush();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private onData(data: string): void {
    this.buffer += data;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_IDLE_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    const raw = this.buffer;
    this.buffer = '';

    const text = cleanPtyOutput(raw);
    if (!text) return;
    if (isTuiNoise(text)) return;

    const id = randomUUID();
    const time = stampChatRowTime();

    try {
      db.insert(chatMessages)
        .values({
          id,
          workItemId: this.workItemId,
          sessionId: this.sessionId,
          senderType: 'agent',
          senderName: this.agentName,
          content: text,
          messageType: 'text',
          metadata: '{}',
          ...time,
        })
        .run();
    } catch {
      return;
    }

    const event: ChatMessageEvent = {
      id,
      workItemId: this.workItemId,
      sessionId: this.sessionId,
      senderType: 'agent',
      senderId: null,
      senderName: this.agentName,
      content: text,
      messageType: 'text',
      metadata: '{}',
      ...time,
    };
    events.emit(chatMessageChannel, event, this.workItemId);

    const wire = toCloudChatBulkMessage(event);
    if (wire) syncQueueService.enqueueChatMessages(this.workItemId, [wire]);
  }
}

/** Keyed by session: two PTY chats in one work item each keep their own bridge. */
const activeBridges = new Map<string, PtyChatBridge>();

export function startBridge(
  workItemId: string,
  pty: Pty,
  agentName: string,
  sessionId: string
): void {
  stopBridge(sessionId);
  const bridge = new PtyChatBridge(workItemId, agentName, sessionId);
  bridge.attach(pty);
  activeBridges.set(sessionId, bridge);
}

export function stopBridge(sessionId: string): void {
  const bridge = activeBridges.get(sessionId);
  if (bridge) {
    bridge.stop();
    activeBridges.delete(sessionId);
  }
}
