import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { readTeamConfigOid, TEAM_CONFIG_FILE } from './read-team-config';

/**
 * The repository page shows `.chord.json` as committed at the base, but a
 * team edit is written into the main checkout. That is only the same file
 * when the checkout's branch has the base's `.chord.json` committed — an
 * uncommitted edit on top of it is fine. Otherwise the write would start
 * from a different file (or none) and drop or change values the page showed
 * (devstation-1q1), so it is refused.
 */
export class TeamFileOffBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamFileOffBaseError';
  }
}

/** The checked-out branch; null on a detached HEAD (`--abbrev-ref` then prints `HEAD`). */
async function readCheckedOutBranch(repoPath: string): Promise<string | null> {
  const { stdout } = await new LocalExecutionContext({ root: repoPath }).exec(GIT_EXECUTABLE, [
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);
  const name = stdout.trim();
  return name === 'HEAD' ? null : name;
}

/** Why a team edit can't be written into `repoPath` now, or null when it can. */
export async function describeTeamFileOffBase(
  repoPath: string,
  baseRef: string
): Promise<string | null> {
  const [headOid, baseOid] = await Promise.all([
    readTeamConfigOid(repoPath, 'HEAD'),
    readTeamConfigOid(repoPath, baseRef),
  ]);
  if (headOid === baseOid) return null;

  const branch = await readCheckedOutBranch(repoPath);
  const where = branch ?? 'a detached HEAD';
  const difference =
    headOid === null
      ? `${where}, which has no ${TEAM_CONFIG_FILE} committed; ${baseRef} has one`
      : baseOid === null
        ? `${where}, which has a ${TEAM_CONFIG_FILE} committed; ${baseRef} has none`
        : `${where}, whose committed ${TEAM_CONFIG_FILE} is not the one at ${baseRef}`;
  return (
    `The main checkout is on ${difference}. Team edits can't be saved there: they would ` +
    `not start from what this page shows. Check out ${baseRef} (or bring it into ${where}) ` +
    `in the main checkout, then save again.`
  );
}

/** Throws `TeamFileOffBaseError` unless a team edit in `repoPath` edits the base's file. */
export async function assertTeamFileOnBase(repoPath: string, baseRef: string): Promise<void> {
  const reason = await describeTeamFileOffBase(repoPath, baseRef);
  if (reason !== null) throw new TeamFileOffBaseError(reason);
}
