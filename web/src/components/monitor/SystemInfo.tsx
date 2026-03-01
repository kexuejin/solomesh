import { Activity } from 'lucide-react';
import { SystemStatus } from '../../stores/monitor';
import { useI18n } from '../../i18n';

interface SystemInfoProps {
  status: SystemStatus;
}

export function SystemInfo({ status }: SystemInfoProps) {
  const { t } = useI18n();
  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  return (
    <div className="surface-card-soft rounded-xl border border-border/70 bg-card/95 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-green-100 rounded-lg">
          <Activity className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">{t('monitor.components.system.title')}</h3>
          <p className="text-2xl font-bold text-foreground">{t('monitor.status.running')}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('monitor.components.system.uptime')}</span>
          <span className="text-foreground font-medium">
            {formatUptime(status.uptime)}
          </span>
        </div>

        {status.claudeCodeVersion !== undefined && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('monitor.components.system.claudeCode')}</span>
            <span className="text-foreground font-medium font-mono text-xs">
              {status.claudeCodeVersion || t('monitor.components.system.unknown')}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('monitor.components.system.feishuConnection')}</span>
          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-600">
            {t('monitor.components.system.connected')}
          </span>
        </div>
      </div>
    </div>
  );
}
