import type { CSSProperties } from 'react';
import type { PickedElement } from '@shared/artifact-frame-messages';
import { AskAgentCard } from '../ask-agent-popover';
import { referenceForPickedElement } from './picked-element';

interface PickedElementCardProps {
  element: PickedElement;
  /** Absent when the viewer cannot have the agent edit this page. */
  onAsk?: (instruction: string) => void;
  onComment: (body: string) => void;
  onCancel: () => void;
}

/** The card's footprint (`w-80`, and the height of its reference + textarea + buttons). */
const CARD_WIDTH = 320;
const CARD_HEIGHT = 190;
const GAP = 8;

/**
 * Places the ask-agent card under the element the user picked. The element's
 * box comes from the frame, in the frame's own viewport, and the frame fills
 * the card's positioned container — so the box maps straight into it. CSS
 * `clamp()` keeps the card inside the container without measuring it.
 */
function placeCard(element: PickedElement): CSSProperties {
  const { x, y, width, height } = element.rect;
  const top = y + height + GAP;
  const left = x + width / 2 - CARD_WIDTH / 2;
  return {
    top: `clamp(${GAP}px, ${top}px, calc(100% - ${CARD_HEIGHT + GAP}px))`,
    left: `clamp(${GAP}px, ${left}px, calc(100% - ${CARD_WIDTH + GAP}px))`,
  };
}

export function PickedElementCard({ element, onAsk, onComment, onCancel }: PickedElementCardProps) {
  return (
    <AskAgentCard
      reference={referenceForPickedElement(element)}
      style={placeCard(element)}
      onAsk={onAsk}
      onComment={onComment}
      onCancel={onCancel}
    />
  );
}
