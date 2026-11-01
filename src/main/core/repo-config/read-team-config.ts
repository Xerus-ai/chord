import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import {
  projectSettingsSchema,
  RETIRED_TEAM_CONFIG_KEYS,
  type ProjectSettings,
} from '@main/core/projects/settings/schema';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

export const TEAM_CONFIG_FILE = '.chord.json';

/** `.chord.json` could not be read or does not describe a valid config. */
export class RepoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepoConfigError';
  }
}

export interface TeamConfigAtRef {
  ref: string;
  /** Blob OID of `.chord.json` at `ref`; null when the ref has no such file. */
  oid: string | null;
  config: ProjectSettings;
  /** Top-level keys the file actually sets — schema defaults fill in the rest of `config`. */
  setKeys: ReadonlySet<string>;
}

/**
 * Parses `.chord.json` content. Throws `RepoConfigError` — never falls back to
 * defaults: a config that silently stops applying changes what runs without
 * anyone being told.
 */
export function parseTeamConfig(raw: string, source: string): ProjectSettings {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new RepoConfigError(`${source} is not valid JSON: ${(error as Error).message}`);
  }

  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const retired = Object.keys(json).filter((key) => key in RETIRED_TEAM_CONFIG_KEYS);
    if (retired.length > 0) {
      const details = retired.map((key) => `\`${key}\` was ${RETIRED_TEAM_CONFIG_KEYS[key]}`);
      throw new RepoConfigError(`${source}: ${details.join('; ')}.`);
    }
  }

  const parsed = projectSettingsSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${where}: ${issue.message}`;
    });
    throw new RepoConfigError(`${source} is invalid — ${issues.join('; ')}`);
  }
  return parsed.data;
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: repoPath }).exec(GIT_EXECUTABLE, args);
  return stdout;
}

/**
 * The committed `.chord.json` at `ref`, read from the object store with
 * `git ls-tree` / `git cat-file` — never from a working tree. That is what
 * keeps an agent's edits to the file in its own checkout (committed on its
 * branch or not) from changing the scripts Chord runs.
 */
export async function readTeamConfigAtRef(repoPath: string, ref: string): Promise<TeamConfigAtRef> {
  const oid = await readTeamConfigOid(repoPath, ref);
  if (oid === null) {
    return { ref, oid: null, config: projectSettingsSchema.parse({}), setKeys: new Set() };
  }

  const raw = await readConfigBlob(repoPath, oid);
  const config = parseTeamConfig(raw, `${TEAM_CONFIG_FILE} at ${ref}`);
  // parseTeamConfig has already proven `raw` is a JSON object.
  const setKeys = new Set(Object.keys(JSON.parse(raw) as object));
  return { ref, oid, config, setKeys };
}

/** Blob OID of `.chord.json` at `ref` (null when absent), without parsing it. */
export async function readTeamConfigOid(repoPath: string, ref: string): Promise<string | null> {
  try {
    await git(repoPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    throw new RepoConfigError(`Cannot read ${TEAM_CONFIG_FILE}: ${ref} does not exist`);
  }

  const entry = (await git(repoPath, ['ls-tree', ref, '--', TEAM_CONFIG_FILE])).trim();
  if (!entry) return null;

  // `<mode> <type> <oid>\t<path>`
  const [meta] = entry.split('\t');
  const [, type, oid] = meta.split(' ');
  if (type !== 'blob' || !oid) {
    throw new RepoConfigError(`${TEAM_CONFIG_FILE} at ${ref} is not a file`);
  }
  return oid;
}

export async function readConfigBlob(repoPath: string, oid: string): Promise<string> {
  return git(repoPath, ['cat-file', 'blob', oid]);
}
