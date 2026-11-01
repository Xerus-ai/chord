import type { GitAiField, GitAiOverride } from '@shared/git-ai';

/**
 * `override` with `field` set to `value`, or — with `undefined` — no longer
 * set, so it inherits again. Empty groups are dropped; an override with
 * nothing left is null (the repository sets nothing itself).
 */
export function setGitAiOverrideField(
  override: GitAiOverride,
  field: GitAiField,
  value: unknown
): GitAiOverride | null {
  const [group, key] = field.split('.') as [keyof GitAiOverride, string | undefined];
  const next: Record<string, unknown> = { ...override };
  if (key === undefined) {
    if (value === undefined) delete next[group];
    else next[group] = value;
  } else {
    const inner: Record<string, unknown> = { ...(next[group] as object | undefined) };
    if (value === undefined) delete inner[key];
    else inner[key] = value;
    if (Object.keys(inner).length > 0) next[group] = inner;
    else delete next[group];
  }
  return Object.keys(next).length > 0 ? (next as GitAiOverride) : null;
}
