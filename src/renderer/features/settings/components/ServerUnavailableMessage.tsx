import { AlertCircle } from 'lucide-react';
import { PRODUCT_NAME } from '@shared/app-identity';

export function ServerUnavailableMessage() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-surface-raised px-3 py-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <p className="text-tiny tracking-tiny text-text-muted">
        {PRODUCT_NAME} server is currently unavailable. Please try again later.
      </p>
    </div>
  );
}
