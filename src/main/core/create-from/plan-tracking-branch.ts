/** A local branch and the ref it tracks (`refs/remotes/<remote>/<branch>`), if any. */
export interface LocalBranchRef {
  name: string;
  upstream: string | null;
}

/**
 * The local branch a remote branch checks out as, named the way `gh pr
 * checkout` names a fork's branch (cli/cli pkg/cmd/pr/checkout): its own name,
 * else `<remote>/<branch>`. Its own name is passed over when it already means
 * something else here — another remote's branch of that name is the preferred
 * remote's, or a local branch of that name tracks something else. A local
 * branch that already tracks this remote branch is that branch
 * (`alreadyTracked`). When both names are taken by something else, the
 * `<remote>/<branch>` name is planned and creating it is refused then
 * (`remote-tracking-branch.ts`), with the reason.
 */
export function planTrackingBranch(args: {
  remote: string;
  branch: string;
  isPreferredRemote: boolean;
  preferredRemoteHasBranch: boolean;
  locals: readonly LocalBranchRef[];
}): { localBranch: string; alreadyTracked: boolean } {
  const tracked = `refs/remotes/${args.remote}/${args.branch}`;
  const qualified = `${args.remote}/${args.branch}`;
  const candidates =
    args.isPreferredRemote || !args.preferredRemoteHasBranch
      ? [args.branch, qualified]
      : [qualified];
  for (const candidate of candidates) {
    const local = args.locals.find((ref) => ref.name === candidate);
    if (!local) return { localBranch: candidate, alreadyTracked: false };
    if (local.upstream === tracked) return { localBranch: candidate, alreadyTracked: true };
  }
  return { localBranch: qualified, alreadyTracked: false };
}
