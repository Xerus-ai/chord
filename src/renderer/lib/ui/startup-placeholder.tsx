/**
 * The window while the app has nothing to show yet (the sync server's verdict
 * on this version, the account session). Blank to the eye, so nothing paints
 * and is then replaced; announced as busy to assistive tech, so it is not an
 * empty window.
 */
export function StartupPlaceholder() {
  return (
    <main aria-busy="true" className="flex h-screen items-center justify-center bg-surface">
      <p role="status" className="sr-only">
        Starting Chord…
      </p>
    </main>
  );
}
