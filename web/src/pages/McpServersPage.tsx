import { useEffect, useState, useMemo } from 'react';
import { Plus, RefreshCw, Server, Download } from 'lucide-react';
import { SearchInput } from '@/components/common';
import { PageHeader } from '@/components/common/PageHeader';
import { SkeletonCardList } from '@/components/common/Skeletons';
import { EmptyState } from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { useMcpServersStore } from '../stores/mcp-servers';
import { useAuthStore } from '../stores/auth';
import { McpServerCard } from '../components/mcp-servers/McpServerCard';
import { McpServerDetail } from '../components/mcp-servers/McpServerDetail';
import { AddMcpServerDialog } from '../components/mcp-servers/AddMcpServerDialog';
import { useI18n } from '../i18n';

export function McpServersPage() {
  const { t } = useI18n();
  const {
    servers,
    loading,
    error,
    syncing,
    loadServers,
    addServer,
    syncHostServers,
  } = useMcpServersStore();

  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return servers.filter(
      (s) =>
        !q ||
        s.id.toLowerCase().includes(q) ||
        (s.command && s.command.toLowerCase().includes(q)) ||
        (s.url && s.url.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)),
    );
  }, [servers, searchQuery]);

  const manualServers = filtered.filter((s) => !s.syncedFromHost);
  const syncedServers = filtered.filter((s) => s.syncedFromHost);

  const enabledCount = servers.filter((s) => s.enabled).length;
  const selectedServer = servers.find((s) => s.id === selectedId) || null;

  const handleSync = async () => {
    setSyncMessage(null);
    try {
      const result = await syncHostServers();
      const { added, updated, deleted, skipped } = result;
      setSyncMessage(
        t('mcp.page.syncDone', { added, updated, deleted, skipped }),
      );
      setTimeout(() => setSyncMessage(null), 5000);
    } catch {
      // error handled by store
    }
  };

  const handleAdd = async (server: Parameters<typeof addServer>[0]) => {
    await addServer(server);
  };

  return (
    <div className="min-h-full app-canvas">
      <div className="mx-auto max-w-7xl space-y-4 px-3 py-4 sm:px-4 lg:px-6">
        {/* Header */}
        <div className="surface-card p-4 md:p-5">
          <PageHeader
            title={t('mcp.page.title')}
            subtitle={
              syncedServers.length > 0
                ? t('mcp.page.subtitleWithSynced', {
                    total: servers.length,
                    synced: syncedServers.length,
                    enabled: enabledCount,
                  })
                : t('mcp.page.subtitle', { total: servers.length, enabled: enabledCount })
            }
            actions={
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                {isAdmin && (
                  <Button variant="outline" onClick={handleSync} disabled={syncing} className="h-10 rounded-xl">
                    <Download size={18} className={syncing ? 'animate-pulse' : ''} />
                    {syncing ? t('mcp.page.syncing') : t('mcp.page.syncHost')}
                  </Button>
                )}
                <Button variant="outline" onClick={loadServers} disabled={loading} className="h-10 rounded-xl">
                  <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  {t('mcp.page.refresh')}
                </Button>
                <Button onClick={() => setShowAddDialog(true)} className="h-10 rounded-xl">
                  <Plus size={18} />
                  {t('mcp.page.add')}
                </Button>
              </div>
            }
          />
        </div>

        {/* Sync message toast */}
        {syncMessage && (
          <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            {syncMessage}
          </div>
        )}

        {/* Content */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
          {/* Left list */}
          <div className="rounded-xl border border-border/70 bg-muted/10 p-4 md:p-5">
            <div className="mb-4">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder={t('mcp.page.searchPlaceholder')}
              />
            </div>

            <div className="space-y-6">
              {loading && servers.length === 0 ? (
                <SkeletonCardList count={3} />
              ) : error ? (
                <div className="rounded-lg border border-red-200 bg-red-50/75 px-4 py-6 text-center">
                  <p className="text-red-600">{error}</p>
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title={searchQuery ? t('mcp.page.emptySearch') : t('mcp.page.empty')}
                  description={searchQuery ? undefined : t('mcp.page.emptyDescription')}
                />
              ) : (
                <>
                  {manualServers.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground/80 mb-3 px-1">
                        {t('mcp.page.manualGroup', { count: manualServers.length })}
                      </h2>
                      <div className="space-y-2">
                        {manualServers.map((server) => (
                          <McpServerCard
                            key={server.id}
                            server={server}
                            selected={selectedId === server.id}
                            onSelect={() => setSelectedId(server.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {syncedServers.length > 0 && (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground/80 mb-3 px-1">
                        {t('mcp.page.syncedGroup', { count: syncedServers.length })}
                      </h2>
                      <div className="space-y-2">
                        {syncedServers.map((server) => (
                          <McpServerCard
                            key={server.id}
                            server={server}
                            selected={selectedId === server.id}
                            onSelect={() => setSelectedId(server.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right detail (desktop) */}
          <div className="hidden lg:block min-w-0">
            <McpServerDetail server={selectedServer} onDeleted={() => setSelectedId(null)} />
          </div>
        </div>

        {/* Mobile detail */}
        {selectedId && selectedServer && (
          <div className="lg:hidden">
            <McpServerDetail server={selectedServer} onDeleted={() => setSelectedId(null)} />
          </div>
        )}
      </div>

      <AddMcpServerDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onAdd={handleAdd}
      />
    </div>
  );
}
