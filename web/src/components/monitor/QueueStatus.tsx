import { ListOrdered } from 'lucide-react';
import { SystemStatus } from '../../stores/monitor';
import { useI18n } from '../../i18n';

interface QueueStatusProps {
  status: SystemStatus;
}

export function QueueStatus({ status }: QueueStatusProps) {
  const { t } = useI18n();
  const groupsWithQueue = status.groups?.filter((g) => g.pendingMessages || g.pendingTasks > 0) || [];

  return (
    <div className="surface-card-soft rounded-xl border border-border/70 bg-card/95 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-amber-100 rounded-lg">
          <ListOrdered className="w-6 h-6 text-amber-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground">{t('monitor.components.queue.title')}</h3>
          <p className="text-2xl font-bold text-foreground">
            {status.queueLength}
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">
          {t('monitor.components.queue.groupSummary', { count: groupsWithQueue.length })}
        </div>

        {groupsWithQueue.length > 0 && (
          <div className="mt-3 space-y-1">
            {groupsWithQueue.slice(0, 3).map((group) => (
              <div
                key={group.jid}
                className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted-foreground truncate">{group.jid}</span>
                  <span className="text-foreground font-medium ml-2">
                    {group.pendingMessages
                      ? t('monitor.components.queue.taskWithMessage', { tasks: group.pendingTasks })
                      : t('monitor.components.queue.taskOnly', { tasks: group.pendingTasks })}
                  </span>
                </div>
              ))}
              {groupsWithQueue.length > 3 && (
                <div className="text-xs text-muted-foreground/80">
                  {t('monitor.components.queue.moreGroups', { count: groupsWithQueue.length - 3 })}
                </div>
              )}
            </div>
        )}
      </div>
    </div>
  );
}
