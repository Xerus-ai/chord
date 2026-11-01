import * as React from 'react';
import { cn } from '@renderer/utils/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-body tracking-body transition-[color,box-shadow] outline-none placeholder:text-text-passive hover:border-border-strong focus-visible:border focus-visible:border-selected-border focus-visible:ring-2 focus-visible:ring-selected-border/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-text-disabled aria-invalid:border-status-err-border aria-invalid:ring-3 aria-invalid:ring-status-err-border/20 md:text-body',
        className
      )}
      {...props}
    />
  );
}

export type TextareaProps = React.ComponentProps<'textarea'>;

export { Textarea };
