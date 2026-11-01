import type { McpCatalogEntry, McpServer } from '@shared/mcp/types';
import type { KVEntry } from './KeyValueSection';

export type McpModalMode =
  | { type: 'add-catalog'; entry: McpCatalogEntry }
  | { type: 'add-custom' }
  /** `entry` is set when the installed server came from the catalog, so editing
   *  enforces the same required credentials that adding does. */
  | { type: 'edit'; server: McpServer; entry?: McpCatalogEntry };

/** Catalog entries declare credentials the server cannot run without — a blank one must block save. */
export function findMissingCredentials(requiredKeys: string[], entries: KVEntry[]): string[] {
  return requiredKeys.filter(
    (key) => !entries.some((entry) => entry.key === key && entry.value.trim().length > 0)
  );
}

/** The catalog entry backing this modal, if any — `add-custom` has none. */
export function getCatalogEntry(mode: McpModalMode): McpCatalogEntry | undefined {
  if (mode.type === 'add-catalog') return mode.entry;
  if (mode.type === 'edit') return mode.entry;
  return undefined;
}

export function getInitialState(mode: McpModalMode) {
  if (mode.type === 'edit') {
    const s = mode.server;
    return {
      name: s.name,
      transport: s.transport,
      command: s.command ?? '',
      args: s.args?.join('\n') ?? '',
      url: s.url ?? '',
      env: Object.entries(s.env ?? {}),
      headers: Object.entries(s.headers ?? {}),
      providers: s.providers,
    };
  }
  if (mode.type === 'add-catalog') {
    const cfg = mode.entry.defaultConfig;
    const isHttp = cfg.type === 'http' || ('url' in cfg && !('command' in cfg));
    const clearPlaceholders = (entries: [string, string][]): [string, string][] =>
      entries.map(([k, v]) => [k, typeof v === 'string' && v.startsWith('YOUR_') ? '' : v]);
    return {
      name: mode.entry.key,
      transport: (isHttp ? 'http' : 'stdio') as 'stdio' | 'http',
      command: (cfg.command as string) ?? '',
      args: Array.isArray(cfg.args) ? (cfg.args as string[]).join('\n') : '',
      url: (cfg.url as string) ?? '',
      env: clearPlaceholders(Object.entries((cfg.env as Record<string, string>) ?? {})),
      headers: clearPlaceholders(Object.entries((cfg.headers as Record<string, string>) ?? {})),
      providers: [] as string[],
    };
  }
  // add-custom
  return {
    name: '',
    transport: 'stdio' as const,
    command: '',
    args: '',
    url: '',
    env: [] as [string, string][],
    headers: [] as [string, string][],
    providers: [] as string[],
  };
}
