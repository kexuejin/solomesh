import { Server } from 'lucide-react';
import { SystemStatus } from '../../stores/monitor';
import { useI18n } from '../../i18n';

interface ContainerStatusProps {
  status: SystemStatus;
}

export function ContainerStatus({ status }: ContainerStatusProps) {
  const { t } = useI18n();
  const maxConcurrent = Math.max(1, status.maxConcurrentContainers || 20);
  const percentage = (status.activeContainers / maxConcurrent) * 100;
  const progressWidth = Math.min(100, percentage);

  return (
    <div className="surface-card-soft rounded-xl border border-border/70 bg-card/95 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-brand-100 rounded-lg">
          <Server className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">{t('monitor.components.container.title')}</h3>
          <p className="text-2xl font-bold text-foreground">
            {status.activeContainers} / {maxConcurrent}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-border/70 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${
            percentage > 80
              ? 'bg-red-500'
              : percentage > 60
              ? 'bg-amber-500'
              : 'bg-green-500'
          }`}
          style={{ width: `${progressWidth}%` }}
        />
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {percentage > 80 && t('monitor.components.container.levelHigh')}
        {percentage > 60 && percentage <= 80 && t('monitor.components.container.levelNormal')}
        {percentage <= 60 && t('monitor.components.container.levelLow')}
      </div>
    </div>
  );
}
