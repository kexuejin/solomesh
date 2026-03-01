import { useState, useEffect, useRef } from 'react';
import { Loader2, WifiOff, CheckCircle2 } from 'lucide-react';
import { useConnectionStatus, type ConnectionStatus } from '../../hooks/useConnectionStatus';
import { useI18n } from '../../i18n';

export function ConnectionBanner() {
  const { t } = useI18n();
  const status = useConnectionStatus();
  const [showRecovered, setShowRecovered] = useState(false);
  const prevStatus = useRef<ConnectionStatus>(status);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (prevStatus.current !== 'connected' && status === 'connected') {
      setShowRecovered(true);
      timerRef.current = setTimeout(() => setShowRecovered(false), 2000);
    }
    prevStatus.current = status;
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [status]);

  if (status === 'connected' && !showRecovered) return null;

  if (showRecovered) {
    return (
      <div className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-2 text-xs font-medium text-emerald-700 shadow-[0_4px_14px_rgba(22,163,74,0.14)] transition-all duration-300 animate-in fade-in slide-in-from-top-2">
        <CheckCircle2 className="w-3.5 h-3.5" />
        <span>{t('chat.connectionBanner.recovered')}</span>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <div className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl border border-red-200/85 bg-red-50/95 px-4 py-2 text-xs font-medium text-red-700 shadow-[0_4px_14px_rgba(220,38,38,0.14)]">
        <WifiOff className="w-3.5 h-3.5" />
        <span>{t('chat.connectionBanner.offline')}</span>
      </div>
    );
  }

  // reconnecting
  return (
    <div className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl border border-amber-200/85 bg-amber-50/95 px-4 py-2 text-xs font-medium text-amber-700 shadow-[0_4px_14px_rgba(217,119,6,0.14)]">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      <span>{t('chat.connectionBanner.reconnecting')}</span>
    </div>
  );
}
