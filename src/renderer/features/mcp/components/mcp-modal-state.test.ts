import { describe, expect, it } from 'vitest';
import type { McpCatalogEntry } from '@shared/mcp/types';
import { findMissingCredentials, getCatalogEntry, getInitialState } from './mcp-modal-state';

const kv = (entries: Array<[string, string]>) =>
  entries.map(([key, value], id) => ({ id, key, value }));

describe('findMissingCredentials', () => {
  it('reports a required key that has no entry at all', () => {
    expect(findMissingCredentials(['API_KEY'], kv([['OTHER', 'x']]))).toEqual(['API_KEY']);
  });

  it('reports a required key whose value is blank or whitespace', () => {
    expect(findMissingCredentials(['API_KEY'], kv([['API_KEY', '']]))).toEqual(['API_KEY']);
    expect(findMissingCredentials(['API_KEY'], kv([['API_KEY', '   ']]))).toEqual(['API_KEY']);
  });

  it('accepts a required key with a real value', () => {
    expect(findMissingCredentials(['API_KEY'], kv([['API_KEY', 'sk-live']]))).toEqual([]);
  });

  it('matches credentials supplied as headers as well as env vars', () => {
    const entries = kv([
      ['ENV_TOKEN', 'from-env'],
      ['Authorization', 'Bearer abc'],
    ]);
    expect(findMissingCredentials(['ENV_TOKEN', 'Authorization'], entries)).toEqual([]);
  });

  it('lists every unfilled key, not just the first', () => {
    const entries = kv([['A', 'set']]);
    expect(findMissingCredentials(['A', 'B', 'C'], entries)).toEqual(['B', 'C']);
  });

  it('has nothing to report when the catalog entry declares no required keys', () => {
    expect(findMissingCredentials([], kv([]))).toEqual([]);
  });
});

describe('getInitialState', () => {
  it('blanks YOUR_-style placeholders so they cannot be saved as real credentials', () => {
    const entry = {
      key: 'example',
      name: 'Example',
      description: '',
      credentialKeys: [{ key: 'API_KEY', required: true }],
      defaultConfig: {
        command: 'npx',
        args: ['-y', 'example-mcp'],
        env: { API_KEY: 'YOUR_API_KEY', REGION: 'us-east-1' },
      },
    } as unknown as McpCatalogEntry;

    const state = getInitialState({ type: 'add-catalog', entry });

    expect(state.transport).toBe('stdio');
    expect(state.env).toEqual([
      ['API_KEY', ''],
      ['REGION', 'us-east-1'],
    ]);
    // A blanked placeholder must still count as missing.
    expect(findMissingCredentials(['API_KEY'], kv(state.env))).toEqual(['API_KEY']);
  });

  it('treats a url-only catalog config as http transport', () => {
    const entry = {
      key: 'remote',
      name: 'Remote',
      description: '',
      credentialKeys: [],
      defaultConfig: { url: 'https://mcp.example.com', headers: { Authorization: 'YOUR_TOKEN' } },
    } as unknown as McpCatalogEntry;

    const state = getInitialState({ type: 'add-catalog', entry });

    expect(state.transport).toBe('http');
    expect(state.url).toBe('https://mcp.example.com');
    expect(state.headers).toEqual([['Authorization', '']]);
  });

  it('round-trips an installed server into editable form values', () => {
    const state = getInitialState({
      type: 'edit',
      server: {
        name: 'installed',
        transport: 'stdio',
        command: 'node',
        args: ['server.js', '--port', '9000'],
        env: { TOKEN: 'abc' },
        providers: ['claude'],
      },
    });

    expect(state.name).toBe('installed');
    expect(state.args).toBe('server.js\n--port\n9000');
    expect(state.env).toEqual([['TOKEN', 'abc']]);
    expect(state.providers).toEqual(['claude']);
  });

  it('starts a custom server empty with no provider selected', () => {
    const state = getInitialState({ type: 'add-custom' });
    expect(state).toMatchObject({ name: '', transport: 'stdio', command: '', providers: [] });
  });
});

describe('getCatalogEntry', () => {
  const entry = {
    key: 'example',
    name: 'Example',
    description: '',
    credentialKeys: [{ key: 'API_KEY', required: true }],
    defaultConfig: { command: 'npx' },
  } as unknown as McpCatalogEntry;

  it('supplies the entry when adding from the catalog', () => {
    expect(getCatalogEntry({ type: 'add-catalog', entry })).toBe(entry);
  });

  it('supplies the entry when editing a server that came from the catalog, so required credentials stay enforced', () => {
    const server = { name: 'example', transport: 'stdio' as const, providers: [] };
    expect(getCatalogEntry({ type: 'edit', server, entry })).toBe(entry);
  });

  it('has no entry for a custom server or an installed server with no catalog match', () => {
    expect(getCatalogEntry({ type: 'add-custom' })).toBeUndefined();
    expect(
      getCatalogEntry({
        type: 'edit',
        server: { name: 'hand-rolled', transport: 'stdio', providers: [] },
      })
    ).toBeUndefined();
  });
});
