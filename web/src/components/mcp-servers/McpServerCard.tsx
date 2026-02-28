import { Download } from 'lucide-react';
import type { McpServer } from '../../stores/mcp-servers';
import { useMcpServersStore } from '../../stores/mcp-servers';

interface McpServerCardProps {
  server: McpServer;
  selected: boolean;
  onSelect: () => void;
}

export function McpServerCard({ server, selected, onSelect }: McpServerCardProps) {
  const toggleServer = useMcpServersStore((s) => s.toggleServer);

  const isHttpType = server.type === 'http' || server.type === 'sse';
  const preview = isHttpType
    ? `${server.type?.toUpperCase()} ${server.url || ''}`
    : [server.command, ...(server.args || [])].join(' ');

  return (
    <button
      onClick={onSelect}
      className={`surface-card-soft w-full rounded-xl border p-4 text-left transition-all ${
        selected
          ? 'border-primary/70 bg-brand-50/75 shadow-[0_12px_26px_rgba(15,107,255,0.16)]'
          : 'border-border/70 bg-card/90 hover:border-brand-200/85 hover:bg-muted/35 hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-foreground truncate">{server.id}</h3>
            {isHttpType && (
              <span className="rounded-lg border border-blue-200/80 bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                {server.type?.toUpperCase()}
              </span>
            )}
            {server.syncedFromHost && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                <Download size={10} />
                已同步
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate font-mono">{preview}</p>
          {server.description && (
            <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-1">{server.description}</p>
          )}
        </div>

        <div
          className="flex items-center"
          onClick={(e) => {
            e.stopPropagation();
            toggleServer(server.id, !server.enabled);
          }}
        >
          <div
            className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full border transition-colors ${
              server.enabled
                ? 'border-brand-200/80 bg-brand-100'
                : 'border-border/80 bg-muted/70'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${
                server.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
