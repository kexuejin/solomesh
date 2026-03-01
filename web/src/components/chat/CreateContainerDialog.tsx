import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Monitor,
  Box,
  FolderInput,
  GitBranch,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DirectoryBrowser } from '../shared/DirectoryBrowser';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { useI18n } from '../../i18n';

interface CreateContainerDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (jid: string, folder: string) => void;
}

export function CreateContainerDialog({
  open,
  onClose,
  onCreated,
}: CreateContainerDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [executionMode, setExecutionMode] = useState<'container' | 'host'>('container');
  const [customCwd, setCustomCwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [initMode, setInitMode] = useState<'empty' | 'local' | 'git'>('empty');
  const [initSourcePath, setInitSourcePath] = useState('');
  const [initGitUrl, setInitGitUrl] = useState('');

  const createFlow = useChatStore((s) => s.createFlow);
  const canHostExec = useAuthStore((s) => s.user?.role === 'admin');

  const reset = () => {
    setName('');
    setAdvancedOpen(false);
    setExecutionMode('container');
    setCustomCwd('');
    setError(null);
    setInitMode('empty');
    setInitSourcePath('');
    setInitGitUrl('');
  };

  const handleClose = () => {
    onClose();
    reset();
  };

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    try {
      const options: Record<string, string> = {};
      if (executionMode === 'host') {
        options.execution_mode = 'host';
        if (customCwd.trim()) options.custom_cwd = customCwd.trim();
      } else {
        if (initMode === 'local' && initSourcePath.trim()) {
          options.init_source_path = initSourcePath.trim();
        } else if (initMode === 'git' && initGitUrl.trim()) {
          options.init_git_url = initGitUrl.trim();
        }
      }
      const created = await createFlow(trimmed, Object.keys(options).length ? options : undefined);
      if (created) {
        onCreated(created.jid, created.folder);
        handleClose();
      } else {
        setError(t('chat.createContainerDialog.errorCreateRetry'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.createContainerDialog.errorCreateFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('chat.createContainerDialog.badge')}
          </div>
        </div>
        <DialogHeader className="px-5 pt-4 text-left">
          <DialogTitle>{t('chat.createContainerDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5">
          {/* Name input */}
          <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
            <label className="block text-sm font-medium text-foreground/80">{t('chat.createContainerDialog.nameLabel')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
              placeholder={t('chat.createContainerDialog.namePlaceholder')}
              autoFocus
            />
          </div>

          {/* Advanced options */}
          <div className="surface-card-soft overflow-hidden border border-border/70">
            <button
              type="button"
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="w-full flex items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 cursor-pointer"
            >
              {advancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {t('chat.createContainerDialog.advancedOptions')}
            </button>
            {advancedOpen && (
              <div className="space-y-3 px-3 pb-3 pt-3">
                {/* Execution mode */}
                <div>
                  <label className="block text-sm font-medium mb-2">{t('chat.createContainerDialog.executionModeLabel')}</label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-2 cursor-pointer transition-colors hover:bg-muted/40">
                      <input
                        type="radio"
                        name="execution_mode"
                        value="container"
                        checked={executionMode === 'container'}
                        onChange={() => { setExecutionMode('container'); setCustomCwd(''); }}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Box className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{t('chat.createContainerDialog.modeContainerLabel')}</span>
                          <span className="text-xs text-primary font-medium">{t('chat.createContainerDialog.recommended')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{t('chat.createContainerDialog.modeContainerHint')}</p>
                      </div>
                    </label>
                    <label className={`flex items-start gap-3 rounded-lg border border-border/70 bg-card p-2 transition-colors ${canHostExec ? 'cursor-pointer hover:bg-muted/40' : 'opacity-50 cursor-not-allowed'}`}>
                      <input
                        type="radio"
                        name="execution_mode"
                        value="host"
                        checked={executionMode === 'host'}
                        onChange={() => { if (canHostExec) { setExecutionMode('host'); setInitMode('empty'); setInitSourcePath(''); setInitGitUrl(''); } }}
                        disabled={!canHostExec}
                        className="mt-0.5 accent-primary"
                      />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Monitor className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium">{t('chat.createContainerDialog.modeHostLabel')}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {canHostExec
                            ? t('chat.createContainerDialog.modeHostHintAdmin')
                            : t('chat.createContainerDialog.modeHostHintNoAdmin')}
                        </p>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Container mode: workspace source */}
                {executionMode === 'container' && (
                  <div className="pt-1">
                    <label className="block text-sm font-medium mb-2">{t('chat.createContainerDialog.sourceLabel')}</label>
                    <div className="space-y-2">
                      <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-2 cursor-pointer transition-colors hover:bg-muted/40">
                        <input type="radio" name="init_mode" value="empty" checked={initMode === 'empty'} onChange={() => setInitMode('empty')} className="mt-0.5 accent-primary" />
                        <div>
                          <span className="text-sm font-medium">{t('chat.createContainerDialog.sourceEmptyLabel')}</span>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('chat.createContainerDialog.sourceEmptyHint')}</p>
                        </div>
                      </label>
                      {canHostExec && (
                        <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-2 cursor-pointer transition-colors hover:bg-muted/40">
                          <input type="radio" name="init_mode" value="local" checked={initMode === 'local'} onChange={() => setInitMode('local')} className="mt-0.5 accent-primary" />
                          <div className="flex-1">
                            <div className="flex items-center gap-1.5">
                              <FolderInput className="w-4 h-4 text-muted-foreground" />
                              <span className="text-sm font-medium">{t('chat.createContainerDialog.sourceLocalLabel')}</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{t('chat.createContainerDialog.sourceLocalHint')}</p>
                          </div>
                        </label>
                      )}
                      {initMode === 'local' && canHostExec && (
                        <div className="ml-6">
                          <DirectoryBrowser
                            value={initSourcePath}
                            onChange={setInitSourcePath}
                            placeholder={t('chat.createContainerDialog.sourceLocalPlaceholder')}
                          />
                        </div>
                      )}
                      <label className="flex items-start gap-3 rounded-lg border border-border/70 bg-card p-2 cursor-pointer transition-colors hover:bg-muted/40">
                        <input type="radio" name="init_mode" value="git" checked={initMode === 'git'} onChange={() => setInitMode('git')} className="mt-0.5 accent-primary" />
                        <div className="flex-1">
                          <div className="flex items-center gap-1.5">
                            <GitBranch className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{t('chat.createContainerDialog.sourceGitLabel')}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{t('chat.createContainerDialog.sourceGitHint')}</p>
                        </div>
                      </label>
                      {initMode === 'git' && (
                        <div className="ml-6">
                          <Input
                            value={initGitUrl}
                            onChange={(e) => setInitGitUrl(e.target.value)}
                            placeholder={t('chat.createContainerDialog.sourceGitPlaceholder')}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Host mode: custom cwd */}
                {executionMode === 'host' && (
                  <>
                    <div className="rounded-lg border border-border/70 bg-card p-2">
                      <DirectoryBrowser
                        value={customCwd}
                        onChange={setCustomCwd}
                        placeholder={t('chat.createContainerDialog.hostCwdPlaceholder')}
                      />
                    </div>
                    <div className="surface-card-soft flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
                      <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700">
                        {t('chat.createContainerDialog.hostWarning')}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="surface-card-soft flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/80 p-3">
              <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 gap-2 border-t border-border/70 bg-muted/20 px-5 py-4 sm:justify-end">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            {t('chat.createContainerDialog.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading && (initMode === 'local' || initMode === 'git')
              ? t('chat.createContainerDialog.creatingWithInit')
              : t('chat.createContainerDialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
