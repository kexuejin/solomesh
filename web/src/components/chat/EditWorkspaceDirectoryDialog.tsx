import { useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DirectoryBrowser } from '../shared/DirectoryBrowser';
import { useChatStore } from '../../stores/chat';
import { useI18n } from '../../i18n';

interface EditWorkspaceDirectoryDialogProps {
  open: boolean;
  jid: string;
  currentName: string;
  currentCwd?: string;
  onClose: () => void;
}

export function EditWorkspaceDirectoryDialog({
  open,
  jid,
  currentName,
  currentCwd,
  onClose,
}: EditWorkspaceDirectoryDialogProps) {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateFlowDirectory = useChatStore((s) => s.updateFlowDirectory);

  useEffect(() => {
    if (!open) return;
    setPath(currentCwd || '');
    setError(null);
  }, [open, currentCwd]);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const trimmed = path.trim();
      const ok = await updateFlowDirectory(jid, trimmed ? trimmed : null);
      if (!ok) {
        setError(useChatStore.getState().error || t('chat.editWorkspaceDirectoryDialog.saveFailed'));
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg overflow-hidden p-0">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('chat.editWorkspaceDirectoryDialog.badge')}
          </div>
        </div>
        <DialogHeader className="px-5 pt-4 text-left">
          <DialogTitle>{t('chat.editWorkspaceDirectoryDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 px-5">
          <p className="text-sm text-muted-foreground">
            {t('chat.editWorkspaceDirectoryDialog.workspaceName', { name: currentName })}
          </p>
          <div className="surface-card-soft border border-border/70 bg-muted/20 p-3">
            <DirectoryBrowser
              value={path}
              onChange={setPath}
              placeholder={t('chat.editWorkspaceDirectoryDialog.placeholder')}
            />
          </div>
          <div className="surface-card-soft flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 p-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              {t('chat.editWorkspaceDirectoryDialog.warning')}
            </p>
          </div>
          {error && (
            <div className="surface-card-soft rounded-lg border border-red-200 bg-red-50/80 px-3 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 gap-2 border-t border-border/70 bg-muted/20 px-5 py-4 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('chat.editWorkspaceDirectoryDialog.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('chat.editWorkspaceDirectoryDialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
