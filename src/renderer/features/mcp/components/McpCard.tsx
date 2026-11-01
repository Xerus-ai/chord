import { ExternalLink, Globe, Pencil, Plus, Terminal } from 'lucide-react';
import { motion } from 'motion/react';
import React from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import type { McpCatalogEntry, McpServer } from '@shared/mcp/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { agentConfig } from '@renderer/utils/agentConfig';
import { McpServerIcon } from '@renderer/utils/mcpIcons';

interface McpCardProps {
  server?: McpServer;
  catalogEntry?: McpCatalogEntry;
  onEdit: (server: McpServer) => void;
  onAdd?: (entry: McpCatalogEntry) => void;
  /**
   * Adding or editing a server needs the agent list. When that load failed the
   * view says these actions "stay disabled until this succeeds" — this is what
   * makes that sentence true instead of opening a modal with an empty provider
   * list.
   */
  disabled?: boolean;
}

function getTransport(server?: McpServer, entry?: McpCatalogEntry): 'stdio' | 'http' {
  if (server) return server.transport;
  const cfg = entry?.defaultConfig;
  if (cfg?.type === 'http' || (cfg && 'url' in cfg && !('command' in cfg))) return 'http';
  return 'stdio';
}

function getSyncedProviders(server?: McpServer) {
  if (!server) return [];
  return server.providers.flatMap((id) => {
    const cfg = agentConfig[id as AgentProviderId];
    return cfg ? [{ id, ...cfg }] : [];
  });
}

export const McpCard: React.FC<McpCardProps> = ({
  server,
  catalogEntry,
  onEdit,
  onAdd,
  disabled = false,
}) => {
  const name = server?.name ?? catalogEntry?.name ?? 'Unknown';
  const description = catalogEntry?.description ?? (server ? `${server.transport} server` : '');
  const isInstalled = !!server;
  const transport = getTransport(server, catalogEntry);
  const docsUrl = catalogEntry?.docsUrl;
  const syncedProviders = getSyncedProviders(server);

  const handleClick = () => {
    if (disabled) return;
    if (isInstalled && server) {
      onEdit(server);
    } else if (catalogEntry && onAdd) {
      onAdd(catalogEntry);
    }
  };

  return (
    <motion.div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className={`group flex w-full items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left text-text shadow-sm transition-[background-color,border-color,box-shadow] duration-100 ${
        disabled
          ? 'cursor-default opacity-50'
          : 'cursor-pointer hover:bg-surface-inset hover:shadow-md'
      }`}
    >
      <McpServerIcon name={name} iconKey={catalogEntry?.key ?? server?.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <h3 className="truncate text-title tracking-title font-semibold">{name}</h3>
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-surface-inset px-1 py-0.5 text-micro tracking-micro text-text-muted">
            {transport === 'http' ? (
              <Globe className="h-2.5 w-2.5" />
            ) : (
              <Terminal className="h-2.5 w-2.5" />
            )}
            {transport}
          </span>
        </div>
        {description && (
          <p className="mt-0.5 line-clamp-1 text-tiny tracking-tiny text-text-muted">
            {description}
          </p>
        )}
        {syncedProviders.length > 0 && (
          <div className="mt-2 flex items-center gap-1">
            {syncedProviders.map((p) => (
              <AgentLogo
                key={p.id}
                logo={p.logo}
                alt={p.alt}
                isSvg={p.isSvg}
                invertInDark={p.invertInDark}
                className="h-3.5 w-3.5 rounded-sm"
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 self-center">
        {docsUrl && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(docsUrl, '_blank', 'noopener,noreferrer');
            }}
            className="rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={`View ${name} docs`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        {isInstalled ? (
          <Pencil className="h-4 w-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        ) : onAdd ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (catalogEntry) onAdd(catalogEntry);
            }}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-inset hover:text-text"
            aria-label={`Add ${name}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </motion.div>
  );
};
