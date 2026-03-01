import { useState } from 'react';
import { Download, Eye, EyeOff, Pencil, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { McpServer } from '../../stores/mcp-servers';
import { useMcpServersStore } from '../../stores/mcp-servers';
import { localeForDateTime, useI18n } from '../../i18n';

interface McpServerDetailProps {
  server: McpServer | null;
  onDeleted?: () => void;
}

export function McpServerDetail({ server, onDeleted }: McpServerDetailProps) {
  const { t, locale } = useI18n();
  const updateServer = useMcpServersStore((s) => s.updateServer);
  const deleteServer = useMcpServersStore((s) => s.deleteServer);

  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showEnvValues, setShowEnvValues] = useState<Record<string, boolean>>({});

  // Edit form state
  const [editCommand, setEditCommand] = useState('');
  const [editArgs, setEditArgs] = useState<string[]>([]);
  const [editEnv, setEditEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [editUrl, setEditUrl] = useState('');
  const [editHeaders, setEditHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  if (!server) {
    return (
      <div className="surface-card-soft flex items-center justify-center rounded-xl border border-border/70 bg-muted/20 p-12">
        <p className="text-muted-foreground/80 text-center">{t('mcp.detail.selectHint')}</p>
      </div>
    );
  }

  const isHttpType = server.type === 'http' || server.type === 'sse';

  const startEdit = () => {
    setEditCommand(server.command || '');
    setEditArgs(server.args ? [...server.args] : []);
    setEditEnv(
      server.env
        ? Object.entries(server.env).map(([key, value]) => ({ key, value }))
        : [],
    );
    setEditUrl(server.url || '');
    setEditHeaders(
      server.headers
        ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
        : [],
    );
    setEditDescription(server.description || '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      if (isHttpType) {
        const headersObj: Record<string, string> = {};
        for (const row of editHeaders) {
          const k = row.key.trim();
          if (k) headersObj[k] = row.value;
        }
        await updateServer(server.id, {
          url: editUrl,
          headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
          description: editDescription || undefined,
        });
      } else {
        const envObj: Record<string, string> = {};
        for (const row of editEnv) {
          const k = row.key.trim();
          if (k) envObj[k] = row.value;
        }
        await updateServer(server.id, {
          command: editCommand,
          args: editArgs.length > 0 ? editArgs : undefined,
          env: Object.keys(envObj).length > 0 ? envObj : undefined,
          description: editDescription || undefined,
        });
      }
      setEditing(false);
    } catch {
      // error handled by store
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t('mcp.detail.confirmDelete', { id: server.id }))) return;
    setDeleting(true);
    try {
      await deleteServer(server.id);
      onDeleted?.();
    } catch {
      // error handled by store
    } finally {
      setDeleting(false);
    }
  };

  const toggleEnvVisibility = (key: string) => {
    setShowEnvValues((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const envEntries = server.env ? Object.entries(server.env) : [];
  const headerEntries = server.headers ? Object.entries(server.headers) : [];

  return (
    <div className="surface-card overflow-hidden rounded-xl">
      {/* Header */}
      <div className="border-b border-border/70 bg-[linear-gradient(140deg,rgba(15,107,255,0.10),rgba(20,184,166,0.08))] p-5 md:p-6">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-xl font-bold text-foreground">{server.id}</h2>
              {server.syncedFromHost && (
                <span className="inline-flex items-center gap-1 rounded-lg border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  <Download size={10} />
                  {t('mcp.common.synced')}
                </span>
              )}
              <span
                className={`rounded-lg border px-2 py-0.5 text-xs font-medium ${
                  server.enabled
                    ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700'
                    : 'border-border/70 bg-muted/60 text-muted-foreground'
                }`}
              >
                {server.enabled ? t('mcp.common.enabled') : t('mcp.common.disabled')}
              </span>
            </div>
            {server.description && (
              <p className="text-sm text-muted-foreground">{server.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!editing && (
              <Button
                onClick={startEdit}
                variant="outline"
              className="h-9 rounded-xl border-border/75 px-3 text-sm text-foreground/80 hover:bg-muted/45"
            >
              <Pencil size={16} />
              {t('mcp.detail.edit')}
            </Button>
          )}
            <Button
              disabled={deleting}
              onClick={handleDelete}
              variant="outline"
              className="h-9 rounded-xl border-red-200/80 px-3 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleting ? t('mcp.detail.deleting') : t('mcp.detail.delete')}
            </Button>
          </div>
        </div>
      </div>

      {editing ? (
        /* Edit Form */
        <div className="space-y-4 p-5 md:p-6">
          {isHttpType ? (
            <>
              {/* URL */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">{t('mcp.detail.url')}</label>
                <Input
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  placeholder={t('mcp.detail.urlPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95 font-mono"
                />
              </div>

              {/* Headers */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">{t('mcp.detail.headers')}</label>
                <div className="space-y-2">
                  {editHeaders.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/20 px-2.5 py-2">
                      <Input
                        value={row.key}
                        onChange={(e) => {
                          const next = [...editHeaders];
                          next[i] = { ...next[i], key: e.target.value };
                          setEditHeaders(next);
                        }}
                        placeholder={t('mcp.detail.headerKeyPlaceholder')}
                        className="h-9 w-1/3 rounded-lg border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => {
                          const next = [...editHeaders];
                          next[i] = { ...next[i], value: e.target.value };
                          setEditHeaders(next);
                        }}
                        placeholder={t('mcp.detail.headerValuePlaceholder')}
                        className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setEditHeaders(editHeaders.filter((_, j) => j !== i))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/80 transition-colors hover:border-red-200/80 hover:bg-red-50 hover:text-red-500"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl border-border/75 px-3"
                    onClick={() => setEditHeaders([...editHeaders, { key: '', value: '' }])}
                  >
                    {t('mcp.detail.addHeader')}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Command */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">{t('mcp.detail.command')}</label>
                <Input
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  placeholder={t('mcp.detail.commandPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
              </div>

              {/* Args */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">{t('mcp.detail.args')}</label>
                <div className="space-y-2">
                  {editArgs.map((arg, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/20 px-2.5 py-2">
                      <Input
                        value={arg}
                        onChange={(e) => {
                          const next = [...editArgs];
                          next[i] = e.target.value;
                          setEditArgs(next);
                        }}
                        className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setEditArgs(editArgs.filter((_, j) => j !== i))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/80 transition-colors hover:border-red-200/80 hover:bg-red-50 hover:text-red-500"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl border-border/75 px-3"
                    onClick={() => setEditArgs([...editArgs, ''])}
                  >
                    {t('mcp.detail.addArg')}
                  </Button>
                </div>
              </div>

              {/* Env */}
              <div>
                <label className="block text-sm font-medium text-foreground/80 mb-1">{t('mcp.detail.env')}</label>
                <div className="space-y-2">
                  {editEnv.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-muted/20 px-2.5 py-2">
                      <Input
                        value={row.key}
                        onChange={(e) => {
                          const next = [...editEnv];
                          next[i] = { ...next[i], key: e.target.value };
                          setEditEnv(next);
                        }}
                        placeholder={t('mcp.detail.envKeyPlaceholder')}
                        className="h-9 w-1/3 rounded-lg border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => {
                          const next = [...editEnv];
                          next[i] = { ...next[i], value: e.target.value };
                          setEditEnv(next);
                        }}
                        placeholder={t('mcp.detail.envValuePlaceholder')}
                        className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setEditEnv(editEnv.filter((_, j) => j !== i))}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground/80 transition-colors hover:border-red-200/80 hover:bg-red-50 hover:text-red-500"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-xl border-border/75 px-3"
                    onClick={() => setEditEnv([...editEnv, { key: '', value: '' }])}
                  >
                    {t('mcp.detail.addEnv')}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">{t('mcp.detail.description')}</label>
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder={t('mcp.detail.descriptionPlaceholder')}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              className="h-10 rounded-xl px-4"
              onClick={saveEdit}
              disabled={saving || (isHttpType ? !editUrl.trim() : !editCommand.trim())}
            >
              <Save size={16} />
              {saving ? t('mcp.detail.saving') : t('mcp.detail.save')}
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-border/75 px-4"
              onClick={cancelEdit}
              disabled={saving}
            >
              {t('mcp.detail.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        /* Read-only View */
        <>
          <div className="space-y-4 border-b border-border/70 p-5 md:p-6">
            {isHttpType ? (
              <>
                {/* Type */}
                <div>
                  <span className="text-sm text-muted-foreground">{t('mcp.detail.type')}</span>
                  <p className="mt-1 rounded-xl border border-brand-200/80 bg-brand-50/70 px-3 py-2 font-mono text-sm text-foreground">
                    {server.type?.toUpperCase()}
                  </p>
                </div>

                {/* URL */}
                <div>
                  <span className="text-sm text-muted-foreground">{t('mcp.detail.url')}</span>
                  <p className="mt-1 break-all rounded-xl border border-border/70 bg-muted/30 px-3 py-2 font-mono text-sm text-foreground">
                    {server.url}
                  </p>
                </div>

                {/* Headers */}
                {headerEntries.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground">{t('mcp.detail.headers')}</span>
                    <div className="space-y-1.5 mt-1">
                      {headerEntries.map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2"
                        >
                          <span className="font-mono text-xs text-foreground/80 font-medium">{key}</span>
                          <span className="text-border">:</span>
                          <span className="font-mono text-xs text-muted-foreground flex-1 truncate">
                            {showEnvValues[key] ? value : '••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleEnvVisibility(key)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:border-border/70 hover:bg-muted/55 hover:text-muted-foreground"
                          >
                            {showEnvValues[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Command */}
                <div>
                  <span className="text-sm text-muted-foreground">{t('mcp.detail.command')}</span>
                  <p className="mt-1 rounded-xl border border-border/70 bg-muted/30 px-3 py-2 font-mono text-sm text-foreground">
                    {server.command}
                  </p>
                </div>

                {/* Args */}
                {server.args && server.args.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground">{t('mcp.detail.args')}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {server.args.map((arg, i) => (
                        <span
                          key={i}
                          className="rounded-lg border border-border/70 bg-muted/60 px-2 py-1 font-mono text-xs text-foreground/85"
                        >
                          {arg}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Env */}
                {envEntries.length > 0 && (
                  <div>
                    <span className="text-sm text-muted-foreground">{t('mcp.detail.env')}</span>
                    <div className="space-y-1.5 mt-1">
                      {envEntries.map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center gap-2 rounded-lg bg-muted/20 px-3 py-2"
                        >
                          <span className="font-mono text-xs text-foreground/80 font-medium">{key}</span>
                          <span className="text-border">=</span>
                          <span className="font-mono text-xs text-muted-foreground flex-1 truncate">
                            {showEnvValues[key] ? value : '••••••••'}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggleEnvVisibility(key)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:border-border/70 hover:bg-muted/55 hover:text-muted-foreground"
                          >
                            {showEnvValues[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Added at */}
            <div className="text-xs text-muted-foreground/80">
              {t('mcp.detail.addedAt', {
                time: new Date(server.addedAt).toLocaleString(localeForDateTime(locale)),
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-muted/25 p-5 md:p-6">
            <p className="text-sm text-muted-foreground/90">
              {server.syncedFromHost
                ? t('mcp.detail.footerSynced')
                : t('mcp.detail.footerManual')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
