import { Input as InputPrimitive } from '@base-ui/react/input';
import * as React from 'react';
import { cn } from '@renderer/utils/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 hover:border-border-strong rounded-md border focus-visible:ring-2 focus-visible:ring-selected-border/30 border-border bg-transparent px-2.5 py-1 text-body tracking-body transition-[color,box-shadow] outline-none placeholder:text-text-passive focus-visible:border focus-visible:border-selected-border disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-text-disabled aria-invalid:border-status-err-border aria-invalid:ring-3 aria-invalid:ring-status-err-border/20 md:text-body',
        className
      )}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.currentTarget.blur();
        }
      }}
      {...props}
    />
  );
}

export { Input };
