/**
 * The MCP server Chord injects into its own agent sessions. The name is
 * reserved: a user server of the same name would shadow or be shadowed by it,
 * and the agent would see two different `mcp__chord__*` tool sets depending on
 * which config won. Matched without regard to case, since the agent CLIs do.
 */
export const CHORD_MCP_SERVER_NAME = 'chord';

export function isReservedMcpServerName(name: string): boolean {
  return name.toLowerCase() === CHORD_MCP_SERVER_NAME;
}
