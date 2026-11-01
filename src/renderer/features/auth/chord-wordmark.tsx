import { cn } from '@renderer/utils/utils';

/**
 * CHORD as a 7×9 dot-matrix raster. Drawn rather than typeset: the app's type
 * scale tops out at `--text-display` (22px), and a hero wordmark wants to be
 * far larger than any text token should go. Rendering it as cells also gives
 * the boot its scanline-era reveal for free — rows light up in sequence.
 */
const GLYPHS: Record<string, string[]> = {
  C: [
    '0111110',
    '1111111',
    '1100000',
    '1100000',
    '1100000',
    '1100000',
    '1100000',
    '1111111',
    '0111110',
  ],
  H: [
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1111111',
    '1111111',
    '1100011',
    '1100011',
    '1100011',
  ],
  O: [
    '0111110',
    '1111111',
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1111111',
    '0111110',
  ],
  R: [
    '1111110',
    '1111111',
    '1100011',
    '1100011',
    '1111111',
    '1111110',
    '1101100',
    '1100110',
    '1100011',
  ],
  D: [
    '1111110',
    '1111111',
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1100011',
    '1111111',
    '1111110',
  ],
};

const ROW_STAGGER_MS = 46;

export function ChordWordmark({ lit, cellPx = 7 }: { lit: boolean; cellPx?: number }) {
  return (
    <div className="flex justify-center gap-[14px]" role="img" aria-label="Chord">
      {'CHORD'.split('').map((letter, letterIndex) => {
        const rows = GLYPHS[letter];
        if (!rows) return null;
        return (
          <div
            key={`${letter}-${letterIndex}`}
            className="grid gap-[1.5px]"
            style={{
              gridTemplateColumns: `repeat(${rows[0].length}, ${cellPx}px)`,
              gridAutoRows: `${cellPx}px`,
            }}
          >
            {rows.flatMap((row, rowIndex) =>
              row
                .split('')
                .map((bit, colIndex) =>
                  bit === '1' ? (
                    <div
                      key={`${rowIndex}-${colIndex}`}
                      className={cn(
                        'rounded-[1px] bg-text transition-[opacity,transform] duration-[220ms] ease-[cubic-bezier(.33,1,.68,1)]',
                        lit ? 'scale-100 opacity-100' : 'scale-[.7] opacity-0'
                      )}
                      style={{ transitionDelay: `${rowIndex * ROW_STAGGER_MS}ms` }}
                    />
                  ) : (
                    <div key={`${rowIndex}-${colIndex}`} />
                  )
                )
            )}
          </div>
        );
      })}
    </div>
  );
}
