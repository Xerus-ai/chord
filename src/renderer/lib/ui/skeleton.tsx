import { cn } from '@renderer/utils/utils';

interface SkeletonProps {
  className?: string;
  /** Predefined shape: 'line' (text-height bar), 'circle' (avatar), 'block' (card area) */
  variant?: 'line' | 'circle' | 'block';
}

export function Skeleton({ className, variant = 'line' }: SkeletonProps) {
  return (
    <div
      className={cn(
        'skeleton',
        variant === 'line' && 'h-3 w-full',
        variant === 'circle' && 'h-6 w-6 rounded-full',
        variant === 'block' && 'h-16 w-full',
        className
      )}
    />
  );
}

export function SidebarRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Skeleton variant="circle" className="h-5 w-5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2 w-1/2" />
      </div>
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="flex max-w-[780px] flex-col gap-2 px-6 py-3">
      <div className="flex items-center gap-2">
        <Skeleton variant="circle" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2 w-12" />
      </div>
      <div className="flex flex-col gap-1 pl-8">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function FileRowSkeleton() {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Skeleton className="h-3 w-3/5" />
      <span className="flex-1" />
      <Skeleton className="h-3 w-12" />
    </div>
  );
}
