import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@renderer/utils/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-body tracking-body font-normal whitespace-nowrap transition-[background-color,color,border-color,box-shadow] duration-100 ease-[cubic-bezier(0.25,1,0.5,1)] outline-none select-none active:scale-[0.97] focus-visible:border-selected-border focus-visible:ring-3 focus-visible:ring-selected-border/30 disabled:pointer-events-none aria-invalid:border-status-err-border aria-invalid:ring-3 aria-invalid:ring-status-err-border/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-action-bg text-action-fg hover:bg-action-bg-hover border border-transparent disabled:bg-action-bg-disabled disabled:text-action-fg-disabled',
        outline:
          'border-border bg-surface hover:bg-surface-raised hover:text-text aria-expanded:bg-surface-raised aria-expanded:text-text disabled:bg-action-bg-disabled disabled:text-action-fg-disabled',
        secondary:
          'bg-surface-inset text-text-muted hover:bg-surface-inset aria-expanded:bg-surface-inset aria-expanded:text-text-muted disabled:bg-action-bg-disabled disabled:text-action-fg-disabled',
        ghost:
          'hover:bg-surface-raised hover:text-text text-text-muted aria-expanded:bg-surface-inset aria-expanded:text-text disabled:text-text-disabled',
        destructive:
          'bg-status-err-bg border border-status-err-border text-status-err hover:bg-status-err-bg-strong focus-visible:border-status-err-border/40 focus-visible:ring-status-err-border/20 disabled:border-border-disabled disabled:bg-action-bg-disabled disabled:text-action-fg-disabled',
        link: 'text-text disabled:text-text-disabled',
      },
      // Control geometry is a contract shared with every other control kind,
      // not a per-button choice: xs 28px, sm 32px, md/lg 44px. Padding steps with the tier
      // (12 / 12 / 16 / 24px) and so does the radius. Never shrink a control
      // locally to fit a context — reach for the smaller tier instead.
      size: {
        default:
          'h-11 gap-1.5 px-4 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-7 gap-1 rounded-[min(var(--radius-md),8px)] px-3 text-tiny tracking-tiny in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        lg: 'h-11 gap-1.5 rounded-xl px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4',
        icon: 'size-11',
        'icon-xs':
          "size-7 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-8 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
