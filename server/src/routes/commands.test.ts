import { describe, expect, it, vi } from 'vitest';

// auth.ts reads WORKOS_CLIENT_ID at import time and throws without it — a
// boot guard, not a test concern. The route module is therefore imported
// dynamically behind a stubbed env, the same way access-control.test.ts does.
vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
const { CreateCommandSchema, stripControlCharacters } = await import('./commands.js');

/**
 * Delivered prompt content ends up on a PTY on the owner's device, so this
 * sanitizer is a security control rather than cosmetics. The gap that
 * motivated these tests: the character class used to jump from \u000C to
 * \u000E, leaving \u000D (CR) in — and CR is this codebase's submit
 * keystroke (keystroke-injection.ts writes \`\r\`). A prompt carrying CR could
 * therefore submit several independent turns from one authorized command,
 * with the cursor snapped back to column zero so the visible terminal need
 * not show what was actually sent.
 */
describe('stripControlCharacters', () => {
  it('strips carriage return, the PTY submit keystroke', () => {
    expect(stripControlCharacters('a\rb')).toBe('ab');
  });

  it('strips a CRLF pair down to the newline', () => {
    expect(stripControlCharacters('a\r\nb')).toBe('a\nb');
  });

  it('preserves newline', () => {
    expect(stripControlCharacters('a\nb')).toBe('a\nb');
  });

  it('preserves tab', () => {
    expect(stripControlCharacters('a\tb')).toBe('a\tb');
  });

  it('strips ESC so escape sequences cannot drive the terminal', () => {
    expect(stripControlCharacters('a\u001B[2Jb')).toBe('a[2Jb');
  });

  it('strips NUL', () => {
    expect(stripControlCharacters('a\u0000b')).toBe('ab');
  });

  it('strips the rest of the C0 range and the C1 range', () => {
    expect(stripControlCharacters('a\u0008\u000B\u000C\u001F\u007F\u009Fb')).toBe('ab');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripControlCharacters('ship it, 100% done')).toBe('ship it, 100% done');
  });
});

/**
 * The route answers 400 straight off CreateCommandSchema.safeParse, so the
 * schema decides the status code. Sanitizing before min(1) is what makes an
 * all-control-character prompt a rejection instead of an empty prompt
 * delivered to the agent.
 */
describe('CreateCommandSchema prompt content', () => {
  const parsePrompt = (content: string) =>
    CreateCommandSchema.safeParse({ kind: 'prompt', payload: { content } });

  it('rejects content that is only control characters', () => {
    expect(parsePrompt('\r\r\u001B\u0000').success).toBe(false);
  });

  it('rejects content that is only carriage returns', () => {
    expect(parsePrompt('\r').success).toBe(false);
  });

  it('accepts content that still has text after sanitizing, with CR removed', () => {
    const result = parsePrompt('deploy\rrm -rf /');
    expect(result.success).toBe(true);
    if (!result.success || result.data.kind !== 'prompt') return;
    expect(result.data.payload.content).toBe('deployrm -rf /');
  });

  it('keeps a multi-line prompt multi-line', () => {
    const result = parsePrompt('first line\n\tindented second');
    expect(result.success).toBe(true);
    if (!result.success || result.data.kind !== 'prompt') return;
    expect(result.data.payload.content).toBe('first line\n\tindented second');
  });
});
