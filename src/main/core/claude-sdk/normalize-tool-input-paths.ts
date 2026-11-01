import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';

/**
 * Tools whose path arguments Node resolves natively, mapped to the argument
 * names that carry a path. The shell tools are deliberately absent: their
 * arguments run *inside* MSYS, where the POSIX form is the correct one and
 * rewriting it would break the command.
 */
const PATH_ARGUMENTS_BY_TOOL = new Map<string, readonly string[]>([
  ['read', ['file_path']],
  ['write', ['file_path']],
  ['edit', ['file_path']],
  ['multiedit', ['file_path']],
  ['notebookedit', ['notebook_path']],
  ['glob', ['path']],
  ['grep', ['path']],
  // Chord's own publish tool: the agent passes the same path it just wrote.
  ['mcp__chord__publish_artifact', ['path']],
]);

/**
 * Rewrites the path arguments of one tool call into real Windows paths.
 * Returns null when the tool takes no path arguments or every path is already
 * correct, so the caller can leave the input untouched.
 */
export function normalizeToolInputPaths(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string
): Record<string, unknown> | null {
  const pathArguments = PATH_ARGUMENTS_BY_TOOL.get(toolName.toLowerCase());
  if (!pathArguments) return null;

  const next = { ...input };
  let rewritten = false;

  for (const argument of pathArguments) {
    const value = next[argument];
    if (typeof value !== 'string' || value.length === 0) continue;
    const resolved = resolveAgentReportedPath(value, cwd);
    if (resolved === value) continue;
    next[argument] = resolved;
    rewritten = true;
  }

  return rewritten ? next : null;
}
