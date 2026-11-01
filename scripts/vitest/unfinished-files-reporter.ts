import type { Reporter, TestModule } from 'vitest/node';

/**
 * Names the test files a run started and never finished (devstation-ce5).
 * When a pool worker dies ("Worker exited unexpectedly"), the default
 * reporter counts the file as not passed but never says which one it was, so
 * a crash under load could not be traced to its file. This reporter keeps the
 * files that started and prints those that did not end.
 */
export default class UnfinishedFilesReporter implements Reporter {
  private readonly running = new Map<string, string>();

  onTestModuleStart(testModule: TestModule): void {
    this.running.set(testModule.id, testModule.relativeModuleId);
  }

  onTestModuleEnd(testModule: TestModule): void {
    this.running.delete(testModule.id);
  }

  onTestRunEnd(): void {
    if (this.running.size === 0) return;
    const files = [...this.running.values()].sort();
    console.error(
      `\nTest files that started and never finished (a worker exited under them):\n${files
        .map((file) => `  ${file}`)
        .join('\n')}\n`
    );
  }
}
