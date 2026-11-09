/**
 * An Electron 44-shaped clipboard for main-process suites: since Electron 44
 * `clipboard.writeText` returns a Promise, and the text is on the clipboard
 * only once it settles. This one settles on a later macrotask, so a caller
 * that does not await the write sees no text when it returns.
 *
 * Imports nothing: an `electron` mock factory loads this module, and any
 * import that reaches `electron` again would wait on the factory forever
 * (same rule as `account/_testing/test-keychain.ts`).
 */
export interface TestClipboard {
  writeText(text: string): Promise<void>;
  /** The text the last settled write left on the clipboard. */
  text(): string;
  /** Every later write rejects with this message, until `reset()`. */
  refuse(message: string): void;
  /** Empty clipboard, writes accepted. */
  reset(): void;
}

export function testClipboard(): TestClipboard {
  let current = '';
  let refusal: string | null = null;
  return {
    writeText(text: string): Promise<void> {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (refusal !== null) {
            reject(new Error(refusal));
            return;
          }
          current = text;
          resolve();
        }, 5);
      });
    },
    text: () => current,
    refuse(message: string) {
      refusal = message;
    },
    reset() {
      current = '';
      refusal = null;
    },
  };
}
