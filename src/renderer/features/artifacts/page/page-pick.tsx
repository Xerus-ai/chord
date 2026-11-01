import { useCallback, useState } from 'react';
import type { PageMode } from '@shared/artifact-frame-constants';
import type { PickedElement } from '@shared/artifact-frame-messages';
import { PickedElementCard } from './picked-element-card';

/**
 * The element a page's click picked, owner's and teammate's frame alike. A
 * pick is dropped when the frame leaves `pick`; releasing one bumps
 * `modeEpoch`, which re-arms the frame's picker for the next click.
 */
export function usePagePick(frameMode: PageMode) {
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [modeEpoch, setModeEpoch] = useState(0);
  // Adjusted while rendering, not in an effect: leaving `pick` drops the pick
  // before the frame shows another mode.
  const [seenMode, setSeenMode] = useState(frameMode);
  if (seenMode !== frameMode) {
    setSeenMode(frameMode);
    if (frameMode !== 'pick') setPicked(null);
  }

  const releasePick = useCallback(() => {
    setPicked(null);
    setModeEpoch((n) => n + 1);
  }, []);

  return { picked, onElementPicked: setPicked, modeEpoch, releasePick };
}

/**
 * The popover over a picked element: Comment for everyone, Ask agent only
 * when `onAskAgent` is given (someone who can have the agent edit the page).
 */
export function PagePickCard({
  picked,
  onAskAgent,
  onComment,
  onRelease,
}: {
  picked: PickedElement;
  onAskAgent?: (element: PickedElement, instruction: string) => void;
  onComment: (element: PickedElement, body: string) => void;
  onRelease: () => void;
}) {
  return (
    <PickedElementCard
      element={picked}
      onAsk={
        onAskAgent
          ? (instruction) => {
              onAskAgent(picked, instruction);
              onRelease();
            }
          : undefined
      }
      onComment={(body) => {
        onComment(picked, body);
        onRelease();
      }}
      onCancel={onRelease}
    />
  );
}
