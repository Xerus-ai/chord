import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { cn } from '@renderer/utils/utils';

/**
 * A command's output under the sentence that explains a failure, folded away
 * until asked for: the sentence is for the user, the output for whoever needs
 * to dig (a failed agent update, git's answer to a failed fetch).
 */
export function FoldedOutput({
  label,
  output,
  className,
}: {
  label: string;
  output: string;
  className?: string;
}) {
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger className="group flex items-center gap-1 rounded text-tiny tracking-tiny font-semibold text-text-muted hover:text-text">
        <ChevronRight
          className="h-3 w-3 transition-transform group-data-[panel-open]:rotate-90"
          aria-hidden="true"
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre
          className={cn(
            'mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-inset p-2',
            'font-mono text-tiny tracking-tiny text-text-muted'
          )}
        >
          {output}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
