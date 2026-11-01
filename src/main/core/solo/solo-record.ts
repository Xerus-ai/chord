import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SoloRecord } from './solo-types';

export const SOLO_REF_PREFIX = 'refs/chord/solo/';

export function soloRefName(laneId: string): string {
  return `${SOLO_REF_PREFIX}${laneId}`;
}

export function soloRecordPath(gitDir: string): string {
  return path.join(gitDir, 'chord-solo.json');
}

export function soloBackupDir(gitDir: string): string {
  return path.join(gitDir, 'chord-solo-backup');
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function parseSoloRecord(raw: string, file: string): SoloRecord {
  const value = JSON.parse(raw) as Partial<SoloRecord>;
  const strings = ['laneId', 'laneCheckoutPath', 'rootHead', 'laneHead', 'snapshotCommit'] as const;
  const valid =
    value.version === 1 &&
    strings.every((key) => typeof value[key] === 'string') &&
    (value.rootBranch === null || typeof value.rootBranch === 'string') &&
    Array.isArray(value.backups) &&
    value.backups.every((entry) => typeof entry === 'string') &&
    typeof value.startedAt === 'string';
  if (!valid) throw new Error(`Unreadable Solo record ${file}: ${raw}`);
  return value as SoloRecord;
}

/** The root's Solo record, or null when no lane holds the root. */
export async function readSoloRecord(gitDir: string): Promise<SoloRecord | null> {
  const file = soloRecordPath(gitDir);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    // No record is the designed "not held" state, not a swallowed failure.
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
  return parseSoloRecord(raw, file);
}

/** Written to a temp file and renamed, so a crash never leaves half a record. */
export async function writeSoloRecord(gitDir: string, record: SoloRecord): Promise<void> {
  const file = soloRecordPath(gitDir);
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

export async function deleteSoloRecord(gitDir: string): Promise<void> {
  await rm(soloRecordPath(gitDir), { force: true });
  await rm(`${soloRecordPath(gitDir)}.tmp`, { force: true });
}
