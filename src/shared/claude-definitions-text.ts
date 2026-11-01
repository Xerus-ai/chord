/**
 * The code a repository's skill, subagent and slash-command files run, as
 * shown by the trust prompt and Repo › Trust: each file's path, then that
 * code indented under it, files sorted by path.
 */
export function formatClaudeDefinitions(definitions: Record<string, string>): string {
  return Object.keys(definitions)
    .sort()
    .map((file) => `${file}\n${definitions[file].replace(/^/gm, '  ')}`)
    .join('\n\n');
}
