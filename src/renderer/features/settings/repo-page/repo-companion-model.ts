/**
 * Repo › General › Companion repository (devstation-4x42.243): the folder the
 * repository sits at inside the companion the user picked. Pure, so the
 * suggestion is tested without a dialog.
 */

function segments(folder: string): string[] {
  return folder.split(/[\\/]+/).filter((segment) => segment !== '');
}

/** Windows paths compare case-insensitively; a drive letter is one either way. */
function sameSegment(a: string, b: string, windows: boolean): boolean {
  return windows ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * The repository's folder relative to the companion, when the repository's
 * main checkout sits inside it (the usual layout); null when it does not,
 * and the user names the folder themselves.
 */
export function suggestAppFolder(companionPath: string, repoPath: string): string | null {
  const windows = /^[a-z]:/i.test(companionPath) || companionPath.includes('\\');
  const outer = segments(companionPath);
  const inner = segments(repoPath);
  if (inner.length <= outer.length) return null;
  if (!outer.every((segment, i) => sameSegment(segment, inner[i], windows))) return null;
  return inner.slice(outer.length).join('/');
}

const FIELD_NAMES: Record<string, string> = {
  'companionRepo.path': 'The companion repository',
  'companionRepo.appFolder': 'The folder',
};

/**
 * A refusal of `repoSettings.updateJustMe` in the row's own words: each
 * `<field>: <reason>` the schema reports names the field as the row does.
 */
export function describeCompanionRefusal(message: string): string {
  return message
    .split('; ')
    .map((part) => {
      const at = part.indexOf(': ');
      const name = at === -1 ? undefined : FIELD_NAMES[part.slice(0, at)];
      return name ? `${name} ${part.slice(at + 2)}` : part;
    })
    .join('; ');
}
