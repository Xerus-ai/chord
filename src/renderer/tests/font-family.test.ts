import { describe, expect, it } from 'vitest';
import { buildFontFamily, MONO_FONT_STACK } from '@renderer/lib/pty/font-family';

describe('buildFontFamily', () => {
  it('is the monospace stack when nothing is configured', () => {
    expect(buildFontFamily()).toBe(MONO_FONT_STACK);
    expect(buildFontFamily(null)).toBe(MONO_FONT_STACK);
    expect(buildFontFamily('   ')).toBe(MONO_FONT_STACK);
  });

  it('puts the configured family, quoted, in front of the stack', () => {
    expect(buildFontFamily('Fira Code')).toBe(`'Fira Code', ${MONO_FONT_STACK}`);
  });

  it('strips quotes the user typed', () => {
    expect(buildFontFamily("'Fira Code'")).toBe(`'Fira Code', ${MONO_FONT_STACK}`);
  });

  it('does not repeat a family the stack already has, in any case', () => {
    expect(buildFontFamily('consolas')).toBe(MONO_FONT_STACK);
    expect(buildFontFamily('DejaVu Sans Mono')).toBe(MONO_FONT_STACK);
  });

  // 'DejaVu Sans' is a prefix of the stack's 'DejaVu Sans Mono'; a substring
  // check took it for the same family and dropped the user's choice, so a
  // terminal on Linux never changed font to it.
  it('puts a family whose name is a prefix of a stack family in front', () => {
    expect(buildFontFamily('DejaVu Sans')).toBe(`'DejaVu Sans', ${MONO_FONT_STACK}`);
    expect(buildFontFamily('Menl')).toBe(`'Menl', ${MONO_FONT_STACK}`);
  });
});
