/**
 * Main's console output goes to whatever launched the app: a terminal, or an
 * e2e runner's pipe. When that reader goes away (the terminal closes, the
 * runner is killed) the next write fails with EPIPE, and Node raises a stream
 * error nobody listens for as an uncaught exception, which Electron shows as
 * a crash dialog. The output has nowhere left to go, so a closed reader is not
 * an app failure. Any other stream error is still thrown.
 */
export function ignoreClosedStdioReaders(
  streams: NodeJS.WriteStream[] = [process.stdout, process.stderr]
): void {
  for (const stream of streams) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') return;
      throw error;
    });
  }
}
