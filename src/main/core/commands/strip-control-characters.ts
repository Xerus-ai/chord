/**
 * The device-side half of the prompt sanitizer that server/src/routes/commands.ts
 * applies on ingest — re-applied here, right before the content reaches the
 * PTY, so an older or bypassed server cannot drive the terminal.
 *
 * \u0009 (tab) and \u000A (newline) are the only C0 codes preserved;
 * everything else in 0..31 is stripped, \u000D (CR) included. CR matters most:
 * it is this codebase's submit keystroke (agent-sessions/keystroke-injection.ts
 * writes `\r`), so a prompt carrying CR would submit several independent turns
 * from one authorized command, and CR returns the cursor to column zero so the
 * visible terminal need not show what was actually sent.
 *
 * Lives in its own module rather than beside its caller because the server
 * keeps an identical copy: the two drifting apart is exactly how CR survived
 * here once already.
 */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
}
