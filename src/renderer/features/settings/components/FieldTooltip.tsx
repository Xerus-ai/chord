import { Info } from 'lucide-react';
import React from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export const FieldTooltip: React.FC<{ content: string }> = ({ content }) => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="text-text-muted hover:text-text"
            aria-label="More information"
          />
        }
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[200px] text-tiny tracking-tiny">
        {content}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
