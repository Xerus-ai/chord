import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import React, { useState } from 'react';
import { describeLoadError, LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import { useModalContext, useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import type { McpModalMode } from './mcp-modal-state';
import { McpCard } from './McpCard';
import { useMcps } from './useMcps';

export const McpView: React.FC = () => {
  const {
    installed,
    catalog,
    providers,
    isLoading,
    loadError,
    providersError,
    isRefreshing,
    saveServer,
    removeServer,
    refresh,
    reload,
    reloadProviders,
  } = useMcps();

  const { showModal, closeModal } = useModalContext();
  const showConfirm = useShowModal('confirmActionModal');
  const [search, setSearch] = useState('');

  const handleRemoveRequest = (serverName: string) => {
    closeModal();
    showConfirm({
      title: 'Remove MCP server?',
      description: `This will remove "${serverName}" from all agents. This action cannot be undone.`,
      confirmLabel: 'Remove',
      onSuccess: () => void removeServer(serverName),
    });
  };

  const openModal = (mode: McpModalMode) => {
    const source =
      mode.type === 'add-catalog' ? 'catalog' : mode.type === 'add-custom' ? 'custom' : null;
    showModal('mcpServerModal', {
      mode,
      providers,
      onSave: (server) => saveServer(server, source),
      onRemove: handleRemoveRequest,
    });
  };

  // Filter
  const lowerSearch = search.toLowerCase();
  const installedNames = new Set(installed.map((s) => s.name));
  const filteredInstalled = installed.filter(
    (s) => !search || s.name.toLowerCase().includes(lowerSearch)
  );
  const filteredCatalog = catalog.filter(
    (c) =>
      !installedNames.has(c.key) &&
      (!search ||
        c.name.toLowerCase().includes(lowerSearch) ||
        c.description.toLowerCase().includes(lowerSearch))
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (loadError) {
    return (
      <LoadErrorNotice
        title="Couldn't load your MCP servers"
        message={describeLoadError(loadError)}
        onRetry={() => void reload()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search servers..."
            className="pl-9"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          disabled={isRefreshing}
          aria-label="Refresh providers"
        >
          <RefreshCw className={`h-4 w-4 text-text-muted ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={providersError != null}
          onClick={() => openModal({ type: 'add-custom' })}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Custom MCP
        </Button>
      </div>

      {providersError && (
        <LoadErrorNotice
          title="Couldn't load your agents"
          message={`${describeLoadError(providersError)} Adding or editing a server needs the agent list, so those actions stay disabled until this succeeds.`}
          onRetry={() => void reloadProviders()}
        />
      )}

      {/* Installed */}
      {filteredInstalled.length > 0 && (
        <div>
          <h3 className="mb-3 section-header">Added</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredInstalled.map((server) => (
              <McpCard
                key={server.name}
                server={server}
                catalogEntry={catalog.find((c) => c.key === server.name)}
                disabled={providersError != null}
                onEdit={(s) =>
                  openModal({
                    type: 'edit',
                    server: s,
                    entry: catalog.find((c) => c.key === s.name),
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Recommended */}
      {filteredCatalog.length > 0 && (
        <div>
          <h3 className="mb-3 section-header">Recommended</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredCatalog.map((entry) => (
              <McpCard
                key={entry.key}
                catalogEntry={entry}
                disabled={providersError != null}
                // Recommended cards are never in the installed state, so their
                // click always routes through onAdd. onEdit is unreachable here.
                onEdit={() => {}}
                onAdd={(e) => openModal({ type: 'add-catalog', entry: e })}
              />
            ))}
          </div>
        </div>
      )}

      {filteredInstalled.length === 0 && filteredCatalog.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-body tracking-body text-text-muted">
            {search ? 'No servers match your search.' : 'No servers available.'}
          </p>
        </div>
      )}
    </div>
  );
};
