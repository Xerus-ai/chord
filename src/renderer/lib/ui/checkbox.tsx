import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { CheckIcon } from 'lucide-react';
import { cn } from '@renderer/utils/utils';

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer relative flex size-4 shrink-0 items-center justify-center rounded-xs border border-border-strong outline-none group-has-disabled/field:border-border-disabled group-has-disabled/field:data-checked:border-selected-border-disabled group-has-disabled/field:data-checked:bg-selected-border-disabled group-has-disabled/field:data-checked:text-selected-fg-disabled after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-selected-border focus-visible:ring-3 focus-visible:ring-selected-border/30 disabled:cursor-not-allowed disabled:border-border-disabled disabled:data-checked:border-selected-border-disabled disabled:data-checked:bg-selected-border-disabled disabled:data-checked:text-selected-fg-disabled aria-invalid:border-status-err-border aria-invalid:ring-3 aria-invalid:ring-status-err-border/20 aria-invalid:aria-checked:border-selected-border data-checked:border-selected-border data-checked:bg-selected-border data-checked:text-selected-fg',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3"
      >
        <CheckIcon absoluteStrokeWidth strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
