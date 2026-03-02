import { useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Trash2 } from 'lucide-react';
import { ScheduledTask } from '../../stores/tasks';
import { TaskDetail } from './TaskDetail';
import { localeForDateTime, useI18n } from '../../i18n';

interface TaskCardProps {
  task: ScheduledTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TaskCard({ task, onPause, onResume, onDelete }: TaskCardProps) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const formatScheduleValue = () => {
    if (task.schedule_type === 'interval') {
      const ms = Number.parseInt(task.schedule_value, 10);
      if (!Number.isFinite(ms) || ms <= 0) return task.schedule_value;
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      if (ms % day === 0) return t('tasks.card.everyDays', { count: ms / day });
      if (ms % hour === 0) return t('tasks.card.everyHours', { count: ms / hour });
      if (ms % minute === 0) return t('tasks.card.everyMinutes', { count: ms / minute });
      if (ms % 1000 === 0) return t('tasks.card.everySeconds', { count: ms / 1000 });
      return t('tasks.card.everyMs', { count: ms });
    }

    if (task.schedule_type === 'once') {
      const parsed = new Date(task.schedule_value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString(localeForDateTime(locale), {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }

    return task.schedule_value;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-600';
      case 'paused':
        return 'bg-amber-100 text-amber-600';
      case 'completed':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return t('tasks.card.statusActive');
      case 'paused':
        return t('tasks.card.statusPaused');
      case 'completed':
        return t('tasks.card.statusCompleted');
      default:
        return status;
    }
  };

  const handleTogglePause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (task.status === 'active') {
      onPause(task.id);
    } else {
      onResume(task.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(task.id);
  };

  return (
    <div className="bg-card rounded-xl border border-border hover:border-brand-300 hover:shadow-[0_10px_22px_rgba(15,23,42,0.09)] transition-all duration-200">
      {/* Card Header - Clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left cursor-pointer"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 mr-4">
            {/* Prompt / Script (truncated 2 lines) */}
            <p className="text-foreground font-medium line-clamp-2 mb-2">
              {task.execution_type === 'script'
                ? task.script_command || task.prompt
                : task.prompt}
            </p>

            {/* Schedule Info */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm mb-2">
              {task.execution_type === 'script' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  {t('tasks.card.executionScript')}
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('tasks.card.schedule')}:</span>
                <span className="text-foreground font-medium">
                  {task.schedule_type === 'cron' && t('tasks.card.scheduleCron')}
                  {task.schedule_type === 'interval' && t('tasks.card.scheduleInterval')}
                  {task.schedule_type === 'once' && t('tasks.card.scheduleOnce')}
                </span>
                <code className="text-xs bg-muted px-2 py-0.5 rounded">
                  {formatScheduleValue()}
                </code>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{t('tasks.card.group')}:</span>
                <span className="text-foreground font-medium">
                  {task.group_folder}
                </span>
              </div>
            </div>

            {/* Status Badge */}
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                  task.status
                )}`}
              >
                {getStatusLabel(task.status)}
              </span>
              {task.task_config?.on_error?.todo_ingest === true && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 border border-brand-200">
                  {t('tasks.card.onErrorTodo')}
                </span>
              )}
              {task.task_config?.on_success?.decision_ingest === true && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  {t('tasks.card.onSuccessDecision')}
                </span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Pause/Resume */}
            {(task.status === 'active' || task.status === 'paused') && (
              <button
                onClick={handleTogglePause}
                className="p-2 text-muted-foreground hover:text-primary hover:bg-brand-50 rounded-lg transition-colors cursor-pointer"
                title={task.status === 'active' ? t('tasks.card.actionPause') : t('tasks.card.actionResume')}
                aria-label={task.status === 'active' ? t('tasks.card.actionPauseAria') : t('tasks.card.actionResumeAria')}
              >
                {task.status === 'active' ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </button>
            )}

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="p-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              title={t('tasks.card.actionDelete')}
              aria-label={t('tasks.card.actionDeleteAria')}
            >
              <Trash2 className="w-5 h-5" />
            </button>

            {/* Expand Icon */}
            <div className="ml-2">
              {expanded ? (
                <ChevronUp className="w-5 h-5 text-muted-foreground/80" />
              ) : (
                <ChevronDown className="w-5 h-5 text-muted-foreground/80" />
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-border">
          <TaskDetail task={task} />
        </div>
      )}
    </div>
  );
}
