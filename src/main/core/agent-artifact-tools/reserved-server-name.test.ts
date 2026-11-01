import { describe, expect, it } from 'vitest';
import { McpService } from '@main/core/mcp/services/McpService';
import { CHORD_MCP_SERVER_NAME } from './chord-server-name';

describe('the reserved chord MCP server name', () => {
  it('is rejected for a user server before any agent config is touched', async () => {
    const service = new McpService();
    await expect(
      service.saveServer({
        name: CHORD_MCP_SERVER_NAME,
        transport: 'stdio',
        command: 'node',
        args: [],
        providers: ['claude'],
      })
    ).rejects.toThrow(/reserved/);
  });

  it('is matched without regard to case', async () => {
    const service = new McpService();
    await expect(
      service.saveServer({
        name: 'Chord',
        transport: 'stdio',
        command: 'node',
        args: [],
        providers: ['claude'],
      })
    ).rejects.toThrow(/reserved/);
  });
});
