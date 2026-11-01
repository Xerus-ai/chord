/**
 * Where the built page runtime lives (`out/artifact-runtime/`, produced by
 * scripts/artifact-runtime). The protocol serves from it and every page view
 * inlines from it. Main configures it once at startup from the app path;
 * suites point it at a directory of their own.
 */
let runtimeDir: string | null = null;

export function configureArtifactRuntimeDir(dir: string): void {
  runtimeDir = dir;
}

export function resolveArtifactRuntimeDir(): string {
  if (!runtimeDir) throw new Error('The artifact page runtime directory is not configured');
  return runtimeDir;
}
