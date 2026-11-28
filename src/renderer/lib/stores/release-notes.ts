/** The release notes field of an update manifest, as electron-updater hands it (UpdateInfo). */
interface ReleaseNotesSource {
  releaseNotes?: string | ReadonlyArray<{ version: string; note: string | null }> | null;
}

/**
 * The markdown to show as what's new (devstation-haay, design F21): the notes as written, or the
 * per-version notes of full changelog mode joined in the order given; null when there are none,
 * so no "What's new" heading is shown over nothing.
 */
export function releaseNotesText(info: ReleaseNotesSource): string | null {
  const raw = info.releaseNotes;
  const text =
    typeof raw === 'string'
      ? raw
      : Array.isArray(raw)
        ? raw
            .map((entry) => entry.note?.trim() ?? '')
            .filter(Boolean)
            .join('\n\n')
        : '';
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}
