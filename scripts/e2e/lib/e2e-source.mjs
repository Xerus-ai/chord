/**
 * The app a suite launches: `built` (out/, the default) or `packaged` (the installer's unpacked
 * app), from CHORD_E2E_SOURCE. Any other value is refused, so a typo never runs the wrong app.
 */
export function e2eSource() {
  const source = process.env.CHORD_E2E_SOURCE ?? 'built';
  if (source !== 'built' && source !== 'packaged') {
    throw new Error(`CHORD_E2E_SOURCE must be 'built' or 'packaged', got '${source}'`);
  }
  return source;
}
