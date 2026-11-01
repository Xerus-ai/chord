/** One plan usage window (5-hour, weekly…) as a provider reports it. */
export interface UsageWindow {
  id: string;
  label: string;
  /** 0–100, rounded. */
  usedPercent: number;
  /** Epoch milliseconds, or null when the provider gives no reset time. */
  resetsAt: number | null;
}
