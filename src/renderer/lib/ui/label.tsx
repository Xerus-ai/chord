import * as React from 'react';
import { cn } from '@renderer/utils/utils';

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-body tracking-body font-normal leading-none text-text-muted select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-text-disabled peer-disabled:cursor-not-allowed peer-disabled:text-text-disabled',
        className
      )}
      {...props}
    />
  );
}

export function MicroLabel({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'cursor-default uppercase font-mono tracking-widest select-none text-tiny',
        className
      )}
      {...props}
    />
  );
}

export { Label };
