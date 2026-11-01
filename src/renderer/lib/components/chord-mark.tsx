import chordMarkOnLight from '@/assets/images/chord/chord-mark-light.png';
import chordMarkOnDark from '@/assets/images/chord/chord-mark.png';
import { cn } from '@renderer/utils/utils';

/**
 * The Chord mark in the colour that reads on the current theme: the light
 * ribbon on chord-dark, the dark ribbon on chord-light. Switched in CSS off the
 * root theme class (theme-provider.tsx), so it reads no theme context.
 */
export function ChordMark({ className, alt = 'Chord' }: { className?: string; alt?: string }) {
  return (
    <>
      <img
        src={chordMarkOnDark}
        alt={alt}
        draggable={false}
        className={cn('chord-light:hidden', className)}
      />
      <img
        src={chordMarkOnLight}
        alt={alt}
        draggable={false}
        className={cn('hidden chord-light:block', className)}
      />
    </>
  );
}
