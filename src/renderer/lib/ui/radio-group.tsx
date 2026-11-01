import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';
import { cn } from '@renderer/utils/utils';

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('grid w-full gap-3', className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        'group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-border-strong outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-selected-border focus-visible:ring-3 focus-visible:ring-selected-border/30 disabled:cursor-not-allowed disabled:border-border-disabled disabled:data-checked:border-selected-border-disabled disabled:data-checked:bg-selected-border-disabled disabled:data-checked:text-selected-fg-disabled aria-invalid:border-status-err-border aria-invalid:ring-3 aria-invalid:ring-status-err-border/20 aria-invalid:aria-checked:border-selected-border data-checked:border-selected-border data-checked:bg-selected-border data-checked:text-selected-fg ',
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-selected-fg" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
