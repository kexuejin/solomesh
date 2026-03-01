import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useI18n } from '../../i18n';

interface SettingsFeedbackProps {
  notice: string | null;
  error: string | null;
  onClearNotice: () => void;
  onClearError: () => void;
}

export function SettingsFeedback({
  notice,
  error,
  onClearNotice,
  onClearError,
}: SettingsFeedbackProps) {
  const { t } = useI18n();

  if (!notice && !error) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      {notice && (
        <div className="surface-card-soft flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="text-sm text-emerald-700">{notice}</div>
          </div>
          <button
            type="button"
            onClick={onClearNotice}
            className="rounded-lg p-1 text-emerald-700/70 transition-colors hover:bg-emerald-100 hover:text-emerald-800"
            aria-label={t('settings.feedback.closeNoticeAria')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="surface-card-soft flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50/80 p-3" aria-live="assertive">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="text-sm text-red-700">{error}</div>
          </div>
          <button
            type="button"
            onClick={onClearError}
            className="rounded-lg p-1 text-red-700/70 transition-colors hover:bg-red-100 hover:text-red-800"
            aria-label={t('settings.feedback.closeErrorAria')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
