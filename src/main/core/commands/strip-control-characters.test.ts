import { describe, expect, it } from 'vitest';
import { stripControlCharacters } from './strip-control-characters';

/**
 * The device-side sanitizer, applied in command-executors.executePrompt
 * just before the content reaches sendInput and then the PTY. It must stay
 * equivalent to the server's copy in server/src/routes/commands.ts; both used
 * to let \u000D (CR) through, and CR is the submit keystroke
 * keystroke-injection.ts writes.
 */
describe('stripControlCharacters', () => {
  it('strips carriage return, so one prompt cannot submit several turns', () => {
    expect(stripControlCharacters('a\rb')).toBe('ab');
  });

  it('strips CR from a CRLF pair but keeps the newline', () => {
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

  it('reduces an all-control-character prompt to empty, which executePrompt rejects', () => {
    expect(stripControlCharacters('\r\r\u001B\u0000')).toBe('');
  });

  it('leaves ordinary multi-line text untouched', () => {
    expect(stripControlCharacters('first line\n\tindented second')).toBe(
      'first line\n\tindented second'
    );
  });
});
