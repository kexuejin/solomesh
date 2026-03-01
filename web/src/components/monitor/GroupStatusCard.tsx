import { Badge } from '@/components/ui/badge';
import { useI18n } from '../../i18n';

interface GroupStatusCardProps {
  group: {
    jid: string;
    active: boolean;
    pendingMessages: boolean;
    pendingTasks: number;
    containerName: string | null;
    displayName: string | null;
  };
}

export function GroupStatusCard({ group }: GroupStatusCardProps) {
  const { t } = useI18n();
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground truncate mr-2">
          {group.jid}
        </span>
        {group.active ? (
          <Badge variant="default" className="bg-green-100 text-green-700 hover:bg-green-200 shrink-0">
            {t('monitor.status.running')}
          </Badge>
        ) : (
          <Badge variant="secondary" className="shrink-0">
            {t('monitor.status.idle')}
          </Badge>
        )}
      </div>

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center justify-between">
          <span>{t('monitor.groups.columns.queue')}</span>
          <span className="text-foreground/80">
            {t('monitor.groups.queueSummary', {
              tasks: group.pendingTasks,
              messageStatus: group.pendingMessages
                ? t('monitor.groups.hasNewMessages')
                : t('monitor.groups.noNewMessages'),
            })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>{t('monitor.groups.columns.process')}</span>
          <span className="text-foreground/80 font-mono truncate ml-2 max-w-[60%] text-right">
            {group.displayName || group.containerName || '-'}
          </span>
        </div>
      </div>
    </div>
  );
}
