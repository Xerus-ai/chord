import { toast } from '@renderer/lib/hooks/use-toast';

/** What a failed comment action says: the action, then why. */
export function describeCommentFailure(action: string, error: unknown): string {
  return `${action} failed: ${error instanceof Error ? error.message : String(error)}`;
}

/** Logs a failed comment action and tells the user, so no button silently does nothing. */
export function reportCommentFailure(action: string, error: unknown): void {
  const description = describeCommentFailure(action, error);
  console.error(`[comments] ${description}`);
  toast({ title: action, description, variant: 'destructive' });
}
