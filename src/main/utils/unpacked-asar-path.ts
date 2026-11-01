/**
 * The unpacked copy of a file that module resolution placed inside `app.asar`,
 * or null when the path is not inside an asar (dev builds, tests).
 *
 * A packaged app resolves every dependency to a path inside `app.asar`.
 * Electron redirects `execFile` for such paths, but not `spawn`, so a native
 * binary that is spawned must be addressed at its `app.asar.unpacked` copy
 * (`electron-builder.config.ts` `asarUnpack` puts it there).
 */
export function unpackedAsarPath(resolved: string): string | null {
  const match = /^(.*[\\/]app\.asar)([\\/].*)$/.exec(resolved);
  if (!match) return null;
  return `${match[1]}.unpacked${match[2]}`;
}
