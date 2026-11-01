import { toast } from '@renderer/lib/hooks/use-toast';

/**
 * Tells the author what the view uploaded for teammates cannot show — remote
 * `http(s)` references do not load in the sandboxed view (design 2026-09-24 §9
 * "View document format"). Nothing is shown when the view is complete.
 */
export function reportViewWarnings(artifactName: string, warnings: readonly string[]): void {
  if (warnings.length === 0) return;
  console.warn(`[artifacts] view of ${artifactName} built with warnings:`, warnings);
  toast({
    title: `Some of ${artifactName} won't load for viewers`,
    description: warnings.join('\n'),
  });
}
