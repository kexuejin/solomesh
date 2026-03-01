import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChatStore } from '../../stores/chat';
import { useI18n } from '../../i18n';

interface RenameDialogProps {
  open: boolean;
  jid: string;
  currentName: string;
  onClose: () => void;
}

export function RenameDialog({ open, jid, currentName, onClose }: RenameDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState(currentName);
  const [loading, setLoading] = useState(false);
  const renameFlow = useChatStore((s) => s.renameFlow);

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      await renameFlow(jid, trimmed);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm overflow-hidden p-0">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('chat.renameDialog.badge')}
          </div>
        </div>
        <DialogHeader className="px-5 pt-4 text-left">
          <DialogTitle>{t('chat.renameDialog.title')}</DialogTitle>
        </DialogHeader>

        <div className="px-5">
          <div className="surface-card-soft space-y-2 border border-border/70 bg-muted/20 p-3">
            <label className="block text-sm font-medium text-foreground/80">{t('chat.renameDialog.nameLabel')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
              placeholder={t('chat.renameDialog.namePlaceholder')}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="mt-4 gap-2 border-t border-border/70 bg-muted/20 px-5 py-4 sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t('chat.renameDialog.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !name.trim()}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('chat.renameDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
