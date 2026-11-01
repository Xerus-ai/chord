import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from '@renderer/utils/utils';

/**
 * Two states that read at a glance (settings redesign, devstation-76ke):
 * off is a solid `border-strong` track, on is the `selected-border` track,
 * and the thumb is solid in both — `text` on off, `selected-fg` on on. No
 * border: the old track was `surface` on a 1px outline, which is the page
 * colour, so an off switch was an outline around a half-alpha dot.
 */
function Switch({
  className,
  size = 'default',
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: 'sm' | 'default';
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        'peer group/switch relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-[background-color,box-shadow] duration-150 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-selected-border/30 aria-invalid:ring-3 aria-invalid:ring-status-err-border/20 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=default]:p-[3px] data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[size=sm]:p-[2px] data-checked:bg-selected-border data-unchecked:bg-border-strong data-disabled:cursor-not-allowed data-disabled:opacity-45',
        className
      )}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey || e.altKey) && (e.key === 'Enter' || e.key === ' ')) {
          e.preventBaseUIHandler?.();
        }
      }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full shadow-sm transition-transform duration-150 group-data-unchecked/switch:bg-text group-data-checked/switch:bg-selected-fg group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5 group-data-[size=default]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-checked:translate-x-2.5 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
