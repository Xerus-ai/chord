/**
 * Whether a workspace rename is submittable. A blank field is not a rename,
 * and re-typing the name the org already has is a no-op the server should
 * never be asked to perform.
 *
 * Shared by the onboarding step and the Team settings card, which are the two
 * places `cloudApi.renameOrg` is called from.
 */
export function canSaveWorkspaceName(input: string, currentName: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed !== currentName;
}
