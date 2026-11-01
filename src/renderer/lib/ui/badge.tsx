import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@renderer/utils/utils';

const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 text-tiny tracking-tiny items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 font-normal whitespace-nowrap transition-[background-color,color,border-color] duration-100 focus-visible:border-selected-border focus-visible:ring-[3px] focus-visible:ring-selected-border/30 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-status-err-border aria-invalid:ring-status-err-border/20 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        default: 'bg-surface text-text [a]:hover:bg-surface-raised',
        secondary: 'bg-surface-inset text-text-muted [a]:hover:bg-surface-inset',
        destructive:
          'bg-status-err-bg text-status-err focus-visible:ring-status-err-border/20 [a]:hover:bg-status-err-bg-strong',
        outline: 'border-border text-text [a]:hover:bg-surface-inset [a]:hover:text-text-muted',
        ghost: 'hover:bg-surface-inset hover:text-text-muted',
        link: 'text-text underline-offset-4 hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({
  className,
  variant = 'default',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  });
}

export { Badge, badgeVariants };
