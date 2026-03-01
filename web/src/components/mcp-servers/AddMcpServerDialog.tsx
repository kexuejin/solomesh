import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '../../i18n';

interface AddMcpServerDialogProps {
  open: boolean;
  onClose: () => void;
  onAdd: (server: {
    id: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    type?: 'http' | 'sse';
    url?: string;
    headers?: Record<string, string>;
    description?: string;
  }) => Promise<void>;
}

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

type ServerType = 'stdio' | 'http' | 'sse';

export function AddMcpServerDialog({ open, onClose, onAdd }: AddMcpServerDialogProps) {
  const { t } = useI18n();
  const [id, setId] = useState('');
  const [serverType, setServerType] = useState<ServerType>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState<string[]>([]);
  const [env, setEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setId('');
    setServerType('stdio');
    setCommand('');
    setArgs([]);
    setEnv([]);
    setUrl('');
    setHeaders([]);
    setDescription('');
    setError(null);
  };

  const handleClose = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };

  const isHttpType = serverType === 'http' || serverType === 'sse';

  const validate = (): string | null => {
    if (!id.trim()) return t('mcp.add.errors.idRequired');
    if (!ID_PATTERN.test(id.trim())) return t('mcp.add.errors.idInvalid');
    if (id.trim().toLowerCase() === 'solomesh') return t('mcp.add.errors.idReserved');
    if (isHttpType) {
      if (!url.trim()) return t('mcp.add.errors.urlRequired');
    } else {
      if (!command.trim()) return t('mcp.add.errors.commandRequired');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isHttpType) {
        const headersObj: Record<string, string> = {};
        for (const row of headers) {
          const k = row.key.trim();
          if (k) headersObj[k] = row.value;
        }
        await onAdd({
          id: id.trim(),
          type: serverType as 'http' | 'sse',
          url: url.trim(),
          headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
          description: description.trim() || undefined,
        });
      } else {
        const envObj: Record<string, string> = {};
        for (const row of env) {
          const k = row.key.trim();
          if (k) envObj[k] = row.value;
        }
        await onAdd({
          id: id.trim(),
          command: command.trim(),
          args: args.length > 0 ? args : undefined,
          env: Object.keys(envObj).length > 0 ? envObj : undefined,
          description: description.trim() || undefined,
        });
      }
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mcp.add.errors.addFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col overflow-hidden p-0">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            MCP
          </div>
        </div>
        <DialogHeader className="px-5 pt-4 text-left">
          <DialogTitle>{t('mcp.add.title')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {/* ID */}
          <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
            <label htmlFor="mcp-id" className="block text-sm font-medium text-foreground/80">
              {t('mcp.add.serverId')} <span className="text-red-500">*</span>
            </label>
            <Input
              id="mcp-id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t('mcp.add.serverIdPlaceholder')}
              disabled={submitting}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('mcp.add.serverIdHint')}
            </p>
          </div>

          {/* Type selector */}
          <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
            <label className="block text-sm font-medium text-foreground/80">{t('mcp.add.type')}</label>
            <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
              {(['stdio', 'http', 'sse'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={submitting}
                  onClick={() => setServerType(t)}
                  className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                    serverType === t
                      ? 'bg-card text-brand-700 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {isHttpType ? (
            <>
              {/* URL */}
              <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
                <label htmlFor="mcp-url" className="block text-sm font-medium text-foreground/80">
                  {t('mcp.add.url')} <span className="text-red-500">*</span>
                </label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('mcp.add.urlPlaceholder')}
                  disabled={submitting}
                  className="h-10 rounded-xl border-border/75 bg-card/95 font-mono"
                />
              </div>

              {/* Headers */}
              <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
                <label className="block text-sm font-medium text-foreground/80">{t('mcp.add.headers')}</label>
                <div className="space-y-2">
                  {headers.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={row.key}
                        onChange={(e) => {
                          const next = [...headers];
                          next[i] = { ...next[i], key: e.target.value };
                          setHeaders(next);
                        }}
                        placeholder={t('mcp.add.headerKeyPlaceholder')}
                        disabled={submitting}
                        className="h-10 w-2/5 rounded-xl border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => {
                          const next = [...headers];
                          next[i] = { ...next[i], value: e.target.value };
                          setHeaders(next);
                        }}
                        placeholder={t('mcp.add.headerValuePlaceholder')}
                        disabled={submitting}
                        className="h-10 flex-1 rounded-xl border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                        disabled={submitting}
                        className="rounded-lg p-1.5 text-muted-foreground/80 transition-colors hover:bg-rose-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setHeaders([...headers, { key: '', value: '' }])}
                    disabled={submitting}
                    className="rounded-lg"
                  >
                    <Plus size={14} />
                    {t('mcp.add.addHeader')}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Command */}
              <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
                <label htmlFor="mcp-command" className="block text-sm font-medium text-foreground/80">
                  {t('mcp.add.command')} <span className="text-red-500">*</span>
                </label>
                <Input
                  id="mcp-command"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder={t('mcp.add.commandPlaceholder')}
                  disabled={submitting}
                  className="h-10 rounded-xl border-border/75 bg-card/95 font-mono"
                />
              </div>

              {/* Args */}
              <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
                <label className="block text-sm font-medium text-foreground/80">{t('mcp.add.args')}</label>
                <div className="space-y-2">
                  {args.map((arg, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={arg}
                        onChange={(e) => {
                          const next = [...args];
                          next[i] = e.target.value;
                          setArgs(next);
                        }}
                        placeholder={t('mcp.add.argPlaceholder', { index: i + 1 })}
                        disabled={submitting}
                        className="h-10 flex-1 rounded-xl border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setArgs(args.filter((_, j) => j !== i))}
                        disabled={submitting}
                        className="rounded-lg p-1.5 text-muted-foreground/80 transition-colors hover:bg-rose-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setArgs([...args, ''])}
                    disabled={submitting}
                    className="rounded-lg"
                  >
                    <Plus size={14} />
                    {t('mcp.add.addArg')}
                  </Button>
                </div>
              </div>

              {/* Env */}
              <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
                <label className="block text-sm font-medium text-foreground/80">{t('mcp.add.env')}</label>
                <div className="space-y-2">
                  {env.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={row.key}
                        onChange={(e) => {
                          const next = [...env];
                          next[i] = { ...next[i], key: e.target.value };
                          setEnv(next);
                        }}
                        placeholder={t('mcp.add.envKeyPlaceholder')}
                        disabled={submitting}
                        className="h-10 w-2/5 rounded-xl border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <Input
                        value={row.value}
                        onChange={(e) => {
                          const next = [...env];
                          next[i] = { ...next[i], value: e.target.value };
                          setEnv(next);
                        }}
                        placeholder={t('mcp.add.envValuePlaceholder')}
                        disabled={submitting}
                        className="h-10 flex-1 rounded-xl border-border/75 bg-card/95 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setEnv(env.filter((_, j) => j !== i))}
                        disabled={submitting}
                        className="rounded-lg p-1.5 text-muted-foreground/80 transition-colors hover:bg-rose-50 hover:text-red-500 disabled:opacity-50"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEnv([...env, { key: '', value: '' }])}
                    disabled={submitting}
                    className="rounded-lg"
                  >
                    <Plus size={14} />
                    {t('mcp.add.addEnv')}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Description */}
          <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
            <label htmlFor="mcp-desc" className="block text-sm font-medium text-foreground/80">
              {t('mcp.add.description')}
            </label>
            <Input
              id="mcp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('mcp.add.descriptionPlaceholder')}
              disabled={submitting}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="surface-card-soft rounded-xl border border-red-200 bg-red-50/80 p-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-4">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={submitting} className="h-10 rounded-xl">
              {t('mcp.add.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !id.trim() || (isHttpType ? !url.trim() : !command.trim())} className="h-10 rounded-xl">
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t('mcp.add.add')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
