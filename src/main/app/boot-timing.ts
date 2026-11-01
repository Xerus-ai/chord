/**
 * Startup milestones in milliseconds since the process started, printed once
 * as a single `[boot]` line when the window's first load finishes. Imported
 * first by `main/index.ts`, so `modules-start` is taken before any other
 * module evaluates; the perf bench (`scripts/perf/bench-startup.mjs`) reads
 * the line from stdout.
 */
const marks: Array<[string, number]> = [];

export function markBoot(name: string): void {
  marks.push([name, Math.round(process.uptime() * 1000)]);
}

export function reportBoot(): void {
  // stdout directly: the logger's level would hide it, and the line is
  // machine-read by the bench.
  process.stdout.write(`[boot] ${JSON.stringify(Object.fromEntries(marks))}\n`);
}

markBoot('modules-start');
