import z from 'zod';

/**
 * A repository's run scripts and run mode (plan 2026-09-26 §"Decisions for
 * Phase 4", Config). `scripts.run` is written two ways: a string is the one
 * run script (id `default`, shown as "Run"); an object names several,
 * `{ "web": "...", "api": "..." }`. `default` is never a named id, so the two
 * forms cannot describe the same scripts differently — which is what keeps
 * the approval hash of a string `run` stable.
 */

export const DEFAULT_RUN_SCRIPT_ID = 'default';

export const RUN_SCRIPT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** `perWorktree`: each lane runs in its own checkout. `solo`: one lane at a time, in the repo root. */
export const RUN_MODES = ['perWorktree', 'solo'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** Run scripts by id; the one string-form script is `default`. */
export type RunScriptMap = Record<string, string>;

/** `scripts.run` as a settings file writes it. */
export type RunScriptsValue = string | RunScriptMap;

/** Why `id` cannot name a run script, or null when it can. */
export function validateRunScriptId(id: string): string | null {
  if (id === DEFAULT_RUN_SCRIPT_ID) {
    return '`default` is the one run script, written as a string: give a named script another id';
  }
  if (!RUN_SCRIPT_ID_PATTERN.test(id)) {
    return 'a run script id uses lowercase letters, digits and dashes, starts with a letter or digit, and is at most 32 characters';
  }
  return null;
}

/** The schema of `scripts.run`, with `command` as the schema of each command. */
export function buildRunScriptsSchema(command: z.ZodString) {
  return z
    .union([command, z.record(z.string(), command)], {
      error: 'must be a command, or an object of named commands',
    })
    .superRefine((value, ctx) => {
      if (typeof value === 'string') return;
      for (const id of Object.keys(value)) {
        const problem = validateRunScriptId(id);
        if (problem) ctx.addIssue({ code: 'custom', message: problem, path: [id] });
      }
    });
}

export function expandRunScripts(value: RunScriptsValue | undefined): RunScriptMap {
  if (value === undefined) return {};
  return typeof value === 'string' ? { [DEFAULT_RUN_SCRIPT_ID]: value } : { ...value };
}

/** The form a settings file writes `scripts` as: undefined when there are none. */
export function collapseRunScripts(scripts: RunScriptMap): RunScriptsValue | undefined {
  const ids = Object.keys(scripts);
  if (ids.length === 0) return undefined;
  if (!ids.includes(DEFAULT_RUN_SCRIPT_ID)) return { ...scripts };
  if (ids.length > 1) {
    throw new Error('The `default` run script cannot sit next to named run scripts');
  }
  return scripts[DEFAULT_RUN_SCRIPT_ID];
}

/**
 * "Run script" for the default script, "Run script · web" for id `web`: for
 * lists that mix kinds of script (the trust prompt, Repo › Trust).
 */
export function formatRunScriptTitle(id: string): string {
  return id === DEFAULT_RUN_SCRIPT_ID ? 'Run script' : `Run script · ${id}`;
}

/** "Run" for the default script, the id alone otherwise: a row under the Run tab's "Run scripts". */
export function formatRunScriptRowTitle(id: string): string {
  return id === DEFAULT_RUN_SCRIPT_ID ? 'Run' : id;
}

export interface RunScriptPair {
  id: string;
  now: string | undefined;
  before: string | undefined;
}

/**
 * Two versions of the run scripts side by side, id by id: the ids of `now` in
 * their order, then those only `before` had.
 */
export function pairRunScripts(
  now: RunScriptsValue | undefined,
  before: RunScriptsValue | undefined
): RunScriptPair[] {
  const current = expandRunScripts(now);
  const previous = expandRunScripts(before);
  // `Object.hasOwn`: an id like `constructor` is valid and must not hit the prototype.
  const ids = [
    ...Object.keys(current),
    ...Object.keys(previous).filter((id) => !Object.hasOwn(current, id)),
  ];
  const read = (scripts: RunScriptMap, id: string) =>
    Object.hasOwn(scripts, id) ? scripts[id] : undefined;
  return ids.map((id) => ({ id, now: read(current, id), before: read(previous, id) }));
}
