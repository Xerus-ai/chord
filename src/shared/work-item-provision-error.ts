/**
 * Why a work item's lane could not be created, as stored in
 * `work_items.provision_error` and carried by `work-item:provision-changed`.
 *
 * Typed rather than a sentence so the banner can offer the action that fits:
 * a base that could not be fetched offers "create from the local copy", which
 * needs the ref and the SHA that copy is at.
 */
export type LaneProvisionError =
  | { type: 'branch_checked_out'; message: string; branch: string; path: string }
  | { type: 'branch_not_found'; message: string; branch: string }
  | { type: 'branch_exists'; message: string; branch: string }
  | { type: 'base_not_found'; message: string; ref: string }
  | {
      type: 'base_fetch_failed';
      message: string;
      ref: string;
      lastFetchedSha: string;
      /**
       * What git said, shown folded under `message` (devstation-kcvy). Absent
       * on errors stored before 2026-10-07, whose message still carries it.
       */
      gitOutput?: string;
    }
  | { type: 'remote_default_unknown'; message: string; remote: string }
  | { type: 'config_invalid'; message: string }
  | { type: 'worktree_failed'; message: string }
  /** The app quit or crashed while provisioning ran; set at the next startup. */
  | { type: 'interrupted'; message: string }
  /** A throw nothing above anticipated; the message is the thrown value. */
  | { type: 'unexpected'; message: string };

/** Every stored error: a lane failure, or one written before errors were typed (migration 0048). */
export type ProvisionError = LaneProvisionError | { type: 'legacy'; message: string };

const REQUIRED_FIELDS: Record<ProvisionError['type'], readonly string[]> = {
  branch_checked_out: ['branch', 'path'],
  branch_not_found: ['branch'],
  branch_exists: ['branch'],
  base_not_found: ['ref'],
  base_fetch_failed: ['ref', 'lastFetchedSha'],
  remote_default_unknown: ['remote'],
  config_invalid: [],
  worktree_failed: [],
  interrupted: [],
  unexpected: [],
  legacy: [],
};

export function serializeProvisionError(error: ProvisionError): string {
  return JSON.stringify(error);
}

/**
 * Reads a stored error back. Throws on anything that is not one: every row
 * holds a typed error (migration 0048 converted the older strings), so an
 * untyped value is a bug to surface, not a shape to guess at.
 */
export function parseProvisionError(stored: string): ProvisionError {
  const value: unknown = JSON.parse(stored);
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Stored provision error is not an object: ${stored}`);
  }
  const record = value as Record<string, unknown>;
  const { type, message } = record;
  if (typeof type !== 'string' || !(type in REQUIRED_FIELDS) || typeof message !== 'string') {
    throw new Error(`Stored provision error has no known type and message: ${stored}`);
  }
  for (const field of REQUIRED_FIELDS[type as ProvisionError['type']]) {
    if (typeof record[field] !== 'string') {
      throw new Error(`Stored ${type} provision error is missing ${field}: ${stored}`);
    }
  }
  if ('gitOutput' in record && typeof record.gitOutput !== 'string') {
    throw new Error(`Stored ${type} provision error has git output that is not text: ${stored}`);
  }
  return record as ProvisionError;
}
