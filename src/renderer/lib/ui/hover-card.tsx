'use client';

import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card';
import { cn } from '@renderer/utils/utils';

/**
 * A hover card that is actually interactive — Base UI's PreviewCard, not
 * Tooltip: it opens on a hover delay like a tooltip, but stays open while the
 * pointer travels into the popup and lets that content receive clicks and
 * focus, which a tooltip's `role="tooltip"` popup never does.
 */
function HoverCard({ ...props }: PreviewCardPrimitive.Root.Props) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({ className, ...props }: PreviewCardPrimitive.Trigger.Props) {
  return (
    <PreviewCardPrimitive.Trigger
      data-slot="hover-card-trigger"
      className={cn('block', className)}
      {...props}
    />
  );
}

function HoverCardContent({
  className,
  side = 'right',
  align = 'start',
  sideOffset = 6,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<PreviewCardPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          className={cn(
            'z-50 w-80 origin-(--transform-origin) rounded-xl bg-surface-raised p-3.5 text-body tracking-body text-text shadow-lg ring-1 ring-text/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
