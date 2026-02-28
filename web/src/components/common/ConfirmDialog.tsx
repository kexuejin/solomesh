import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { isConfirmPhraseMatched } from '@/lib/confirm-phrase';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'danger';
  requireConfirmText?: string;
  requireConfirmLabel?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  confirmVariant = 'primary',
  requireConfirmText,
  requireConfirmLabel = '请输入名称确认操作',
  loading = false,
}: ConfirmDialogProps) {
  const [confirmInput, setConfirmInput] = useState('');

  useEffect(() => {
    if (!open) {
      setConfirmInput('');
    }
  }, [open]);

  const requiresPhrase = typeof requireConfirmText === 'string' && requireConfirmText.trim().length > 0;
  const phraseMatched = !requiresPhrase || isConfirmPhraseMatched(requireConfirmText || '', confirmInput);
  const confirmDisabled = loading || !phraseMatched;

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent className="surface-card gap-0 overflow-hidden border-border/70 p-0">
        <div className="border-b border-border/70 bg-muted/30 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600">
            确认操作
          </div>
        </div>
        <AlertDialogHeader className="gap-2 px-5 pt-4 text-left">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        {requiresPhrase && (
          <div className="surface-card-soft mx-5 mt-4 space-y-2 border border-border/70 bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">
              {requireConfirmLabel}：<span className="font-medium text-foreground">{requireConfirmText}</span>
            </div>
            <Input
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={requireConfirmText}
              autoFocus
            />
          </div>
        )}
        <AlertDialogFooter className="mt-4 gap-2 border-t border-border/70 bg-muted/20 px-5 py-4 sm:justify-end">
          <AlertDialogCancel disabled={loading} className="sm:min-w-24">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={confirmDisabled}
            className={cn(
              "gap-2 sm:min-w-24",
              confirmVariant === 'danger' &&
                'bg-destructive text-white hover:bg-destructive/90',
            )}
          >
            {loading && <Loader2 className="size-4 animate-spin" />}
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
