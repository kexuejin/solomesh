import { useEffect, useState } from 'react';
import { ScheduledTask, useTasksStore } from '../../stores/tasks';
import { localeForDateTime, useI18n } from '../../i18n';

interface TaskDetailProps {
  task: ScheduledTask;
}

export function TaskDetail({ task }: TaskDetailProps) {
  const { t, locale } = useI18n();
  const { logs, loadLogs, updateTaskOnErrorTodoRule, updateTaskOnSuccessDecisionRule } = useTasksStore();
  const taskLogs = logs[task.id] || [];
  const onErrorTodoRuleEnabled = task.task_config?.on_error?.todo_ingest === true;
  const onSuccessDecisionRuleEnabled = task.task_config?.on_success?.decision_ingest === true;
  const [updatingOnErrorRule, setUpdatingOnErrorRule] = useState(false);
  const [updatingOnSuccessRule, setUpdatingOnSuccessRule] = useState(false);

  useEffect(() => {
    loadLogs(task.id);
  }, [task.id, loadLogs]);

  const formatDate = (timestamp: string | null | undefined) => {
    if (!timestamp) return '-';
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return timestamp;
    return parsed.toLocaleString(localeForDateTime(locale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const formatScheduleValue = () => {
    if (task.schedule_type === 'interval') {
      const ms = Number.parseInt(task.schedule_value, 10);
      if (!Number.isFinite(ms) || ms <= 0) return task.schedule_value;
      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      if (ms % day === 0) return t('tasks.detail.everyDays', { count: ms / day });
      if (ms % hour === 0) return t('tasks.detail.everyHours', { count: ms / hour });
      if (ms % minute === 0) return t('tasks.detail.everyMinutes', { count: ms / minute });
      if (ms % 1000 === 0) return t('tasks.detail.everySeconds', { count: ms / 1000 });
      return t('tasks.detail.everyMs', { count: ms });
    }
    if (task.schedule_type === 'once') {
      const parsed = new Date(task.schedule_value);
      if (!Number.isNaN(parsed.getTime())) return formatDate(parsed.toISOString());
    }
    return task.schedule_value;
  };

  const handleToggleOnErrorTodoRule = async () => {
    setUpdatingOnErrorRule(true);
    try {
      await updateTaskOnErrorTodoRule(task.id, !onErrorTodoRuleEnabled);
    } finally {
      setUpdatingOnErrorRule(false);
    }
  };

  const handleToggleOnSuccessDecisionRule = async () => {
    setUpdatingOnSuccessRule(true);
    try {
      await updateTaskOnSuccessDecisionRule(task.id, !onSuccessDecisionRuleEnabled);
    } finally {
      setUpdatingOnSuccessRule(false);
    }
  };

  return (
    <div className="p-4 bg-muted/40 space-y-4">
      {/* Script Command (script mode) */}
      {task.execution_type === 'script' && task.script_command && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">{t('tasks.detail.scriptCommand')}</div>
          <pre className="text-sm text-foreground bg-card px-3 py-2 rounded border border-border whitespace-pre-wrap font-mono">
            {task.script_command}
          </pre>
        </div>
      )}

      {/* Full Prompt / Description */}
      {task.prompt && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">
            {task.execution_type === 'script'
              ? t('tasks.detail.taskDescription')
              : t('tasks.detail.fullPrompt')}
          </div>
          <div className="text-sm text-foreground bg-card px-3 py-2 rounded border border-border whitespace-pre-wrap">
            {task.prompt}
          </div>
        </div>
      )}

      {/* Schedule Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.executionType')}</div>
          <div className="text-sm text-foreground">
            {task.execution_type === 'script'
              ? t('tasks.detail.executionScript')
              : t('tasks.detail.executionAgent')}
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.scheduleType')}</div>
          <div className="text-sm text-foreground">
            {task.schedule_type === 'cron' && t('tasks.detail.scheduleTypeCron')}
            {task.schedule_type === 'interval' && t('tasks.detail.scheduleTypeInterval')}
            {task.schedule_type === 'once' && t('tasks.detail.scheduleTypeOnce')}
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.scheduleValue')}</div>
          <code className="text-sm text-foreground bg-card px-2 py-1 rounded border border-border">
            {formatScheduleValue()}
          </code>
          {task.schedule_type !== 'cron' && (
            <div className="mt-1 text-xs text-muted-foreground">
              {t('tasks.detail.rawValue', { value: task.schedule_value })}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.nextRun')}</div>
          <div className="text-sm text-foreground">
            {formatDate(task.next_run)}
          </div>
        </div>

        {task.last_run && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.lastRun')}</div>
            <div className="text-sm text-foreground">
              {formatDate(task.last_run)}
            </div>
          </div>
        )}

        {task.execution_type !== 'script' && (
          <div>
            <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.contextMode')}</div>
            <div className="text-sm text-foreground">
              {task.context_mode === 'group'
                ? t('tasks.detail.contextGroup')
                : task.context_mode === 'isolated'
                  ? t('tasks.detail.contextIsolated')
                  : task.context_mode}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.createdAt')}</div>
          <div className="text-sm text-foreground">
            {formatDate(task.created_at)}
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.onErrorTodoRule')}</div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-foreground">
              {onErrorTodoRuleEnabled
                ? t('tasks.detail.enabled')
                : t('tasks.detail.disabled')}
            </div>
            <button
              type="button"
              onClick={handleToggleOnErrorTodoRule}
              disabled={updatingOnErrorRule}
              className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updatingOnErrorRule
                ? t('tasks.detail.updatingRule')
                : onErrorTodoRuleEnabled
                  ? t('tasks.detail.disableRule')
                  : t('tasks.detail.enableRule')}
            </button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {onErrorTodoRuleEnabled
              ? t('tasks.detail.onErrorTodoRuleEnabledHint')
              : t('tasks.detail.onErrorTodoRuleDisabledHint')}
          </div>
        </div>

        <div>
          <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.onSuccessDecisionRule')}</div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-foreground">
              {onSuccessDecisionRuleEnabled
                ? t('tasks.detail.enabled')
                : t('tasks.detail.disabled')}
            </div>
            <button
              type="button"
              onClick={handleToggleOnSuccessDecisionRule}
              disabled={updatingOnSuccessRule}
              className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              {updatingOnSuccessRule
                ? t('tasks.detail.updatingRule')
                : onSuccessDecisionRuleEnabled
                  ? t('tasks.detail.disableRule')
                  : t('tasks.detail.enableRule')}
            </button>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {onSuccessDecisionRuleEnabled
              ? t('tasks.detail.onSuccessDecisionRuleEnabledHint')
              : t('tasks.detail.onSuccessDecisionRuleDisabledHint')}
          </div>
        </div>

        {task.last_result && (
          <div className="col-span-1 md:col-span-2">
            <div className="text-xs text-muted-foreground mb-1">{t('tasks.detail.lastResult')}</div>
            <div className="text-sm text-foreground bg-card px-3 py-2 rounded border border-border whitespace-pre-wrap break-words">
              {task.last_result}
            </div>
          </div>
        )}
      </div>

      {/* Execution Logs */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">{t('tasks.detail.logs')}</div>
        {taskLogs.length === 0 ? (
          <div className="text-sm text-muted-foreground/80 bg-card px-3 py-4 rounded border border-border text-center">
            {t('tasks.detail.noLogs')}
          </div>
        ) : (
          <div className="overflow-x-auto bg-card rounded border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('tasks.detail.runAt')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('tasks.detail.duration')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('tasks.detail.status')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    {t('tasks.detail.result')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {taskLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/40">
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      {formatDate(log.run_at)}
                    </td>
                    <td className="px-3 py-2 text-foreground whitespace-nowrap">
                      {formatDuration(log.duration_ms)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          log.status === 'success'
                            ? 'bg-green-100 text-green-600'
                            : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {log.status === 'success' ? t('tasks.detail.success') : t('tasks.detail.failed')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground max-w-xs truncate">
                      {log.status === 'success'
                        ? log.result || '-'
                        : log.error || t('tasks.detail.unknownError')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
