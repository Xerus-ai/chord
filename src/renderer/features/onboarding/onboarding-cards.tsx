import { cn } from '@renderer/utils/utils';

export function SvgIcon({ raw, className }: { raw: string; className?: string }) {
  const processed = raw
    .replace(/\bfill="[^"]*"/g, 'fill="currentColor"')
    .replace(/\bstroke="[^"]*"/g, 'stroke="currentColor"');
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center text-text-muted [&_svg]:h-full [&_svg]:w-full',
        className
      )}
      dangerouslySetInnerHTML={{ __html: processed }}
    />
  );
}
