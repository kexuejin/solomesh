import { useEffect, useMemo, useState } from 'react';
import { Clock3, Loader2, Sparkles, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  getAutomationTemplates,
  type AutomationTemplate,
  type ContextMode,
  type ScheduleType,
} from './automation-presets';
import { useI18n } from '../../i18n';
import type { TaskConfig } from '../../stores/tasks';

interface Group {
  jid: string;
  name: string;
  folder: string;
}

interface CreateTaskFormProps {
  groups: Group[];
  initialTemplateId?: string | null;
  isAdmin?: boolean;
  onSubmit: (data: {
    groupFolder: string;
    chatJid: string;
    prompt: string;
    scheduleType: ScheduleType;
    scheduleValue: string;
    contextMode: ContextMode;
    executionType: 'agent' | 'script';
    scriptCommand: string;
    taskConfig: TaskConfig | null;
  }) => Promise<void>;
  onClose: () => void;
}

type ScheduleMode = 'daily' | 'interval';
type IntervalUnit = 'minute' | 'hour';

const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;
const ALL_WEEKDAYS = [...WEEKDAY_VALUES];
const WORKDAYS = [1, 2, 3, 4, 5];
const TEMPLATE_NONE = '__none__';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKeys(value: object | null | undefined): boolean {
  if (!value) return false;
  return Object.keys(value).length > 0;
}

function deepMergeObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeObjects(current, value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function toTaskConfigJson(value: TaskConfig | null | undefined): string {
  if (!isPlainObject(value) || !hasOwnKeys(value)) return '';
  return JSON.stringify(value, null, 2);
}

function uniqueSortedWeekdays(days: number[]): number[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return [...new Set(days)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function weekdaysToCron(days: number[]): string {
  const normalized = uniqueSortedWeekdays(days);
  if (normalized.length === 7) return '*';
  return normalized.join(',');
}

function parseCronWeekdays(expr: string): number[] {
  if (!expr || expr === '*') return [...ALL_WEEKDAYS];
  const tokens = expr.split(',');
  const result: number[] = [];
  for (const tokenRaw of tokens) {
    const token = tokenRaw.trim();
    if (!token) continue;

    if (token.includes('-')) {
      const [startRaw, endRaw] = token.split('-');
      const start = Number.parseInt(startRaw, 10);
      const end = Number.parseInt(endRaw, 10);
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end) {
        for (let d = start; d <= end; d += 1) {
          if (d >= 0 && d <= 7) result.push(d === 7 ? 0 : d);
        }
      }
      continue;
    }

    const value = Number.parseInt(token, 10);
    if (Number.isFinite(value) && value >= 0 && value <= 7) {
      result.push(value === 7 ? 0 : value);
    }
  }

  const normalized = uniqueSortedWeekdays(result);
  return normalized.length > 0 ? normalized : [...ALL_WEEKDAYS];
}

function buildDailyCron(time: string, weekdays: number[]): string {
  const [hText, mText] = time.split(':');
  const hour = Number.parseInt(hText || '9', 10);
  const minute = Number.parseInt(mText || '0', 10);
  return `${minute} ${hour} * * ${weekdaysToCron(weekdays)}`;
}

function buildIntervalCron(count: number, unit: IntervalUnit, weekdays: number[]): string {
  const dow = weekdaysToCron(weekdays);
  if (unit === 'minute') {
    return `*/${count} * * * ${dow}`;
  }
  return `0 */${count} * * ${dow}`;
}

function parseTemplateSchedule(template: AutomationTemplate): {
  mode: ScheduleMode;
  dailyTime: string;
  dailyWeekdays: number[];
  intervalNumber: string;
  intervalUnit: IntervalUnit;
  intervalWeekdays: number[];
} {
  const fallback = {
    mode: 'daily' as ScheduleMode,
    dailyTime: '09:00',
    dailyWeekdays: [...WORKDAYS],
    intervalNumber: '30',
    intervalUnit: 'minute' as IntervalUnit,
    intervalWeekdays: [...WORKDAYS],
  };

  if (template.scheduleType === 'interval') {
    const ms = Number.parseInt(template.scheduleValue, 10);
    if (!Number.isFinite(ms) || ms <= 0) return fallback;

    if (ms % (60 * 60 * 1000) === 0) {
      return {
        ...fallback,
        mode: 'interval',
        intervalNumber: String(ms / (60 * 60 * 1000)),
        intervalUnit: 'hour',
      };
    }

    return {
      ...fallback,
      mode: 'interval',
      intervalNumber: String(Math.max(1, Math.round(ms / (60 * 1000)))),
      intervalUnit: 'minute',
    };
  }

  if (template.scheduleType === 'cron') {
    const trimmed = template.scheduleValue.trim();

    // pattern: */N * * * DOW
    const minuteInterval = trimmed.match(/^\*\/(\d+) \* \* \* ([0-7,\-*]+)$/);
    if (minuteInterval) {
      return {
        ...fallback,
        mode: 'interval',
        intervalNumber: minuteInterval[1],
        intervalUnit: 'minute',
        intervalWeekdays: parseCronWeekdays(minuteInterval[2]),
      };
    }

    // pattern: 0 */N * * DOW
    const hourInterval = trimmed.match(/^0 \*\/(\d+) \* \* ([0-7,\-*]+)$/);
    if (hourInterval) {
      return {
        ...fallback,
        mode: 'interval',
        intervalNumber: hourInterval[1],
        intervalUnit: 'hour',
        intervalWeekdays: parseCronWeekdays(hourInterval[2]),
      };
    }

    // pattern: M H * * DOW
    const daily = trimmed.match(/^(\d{1,2}) (\d{1,2}) \* \* ([0-7,\-*]+)$/);
    if (daily) {
      const minute = String(Number.parseInt(daily[1], 10)).padStart(2, '0');
      const hour = String(Number.parseInt(daily[2], 10)).padStart(2, '0');
      return {
        ...fallback,
        mode: 'daily',
        dailyTime: `${hour}:${minute}`,
        dailyWeekdays: parseCronWeekdays(daily[3]),
      };
    }
  }

  return fallback;
}

export function CreateTaskForm({
  groups,
  initialTemplateId,
  isAdmin = false,
  onSubmit,
  onClose,
}: CreateTaskFormProps) {
  const { t } = useI18n();
  const templates = getAutomationTemplates(t);
  const weekdayOptions = useMemo(
    () => [
      { label: t('tasks.form.weekdayMon'), value: 1 },
      { label: t('tasks.form.weekdayTue'), value: 2 },
      { label: t('tasks.form.weekdayWed'), value: 3 },
      { label: t('tasks.form.weekdayThu'), value: 4 },
      { label: t('tasks.form.weekdayFri'), value: 5 },
      { label: t('tasks.form.weekdaySat'), value: 6 },
      { label: t('tasks.form.weekdaySun'), value: 0 },
    ],
    [t],
  );
  const [formData, setFormData] = useState({
    groupFolder: groups[0]?.folder || '',
    chatJid: groups[0]?.jid || '',
    prompt: '',
    scheduleType: 'cron' as ScheduleType,
    scheduleValue: '',
    contextMode: 'isolated' as ContextMode,
    executionType: 'agent' as 'agent' | 'script',
    scriptCommand: '',
  });

  const [templateChoice, setTemplateChoice] = useState<string>(TEMPLATE_NONE);

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('daily');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [dailyWeekdays, setDailyWeekdays] = useState<number[]>([...WORKDAYS]);

  const [intervalNumber, setIntervalNumber] = useState('30');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minute');
  const [intervalWeekdays, setIntervalWeekdays] = useState<number[]>([...WORKDAYS]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [onErrorTodoIngest, setOnErrorTodoIngest] = useState(false);
  const [onSuccessDecisionIngest, setOnSuccessDecisionIngest] = useState(false);
  const [taskConfigJson, setTaskConfigJson] = useState('');

  useEffect(() => {
    if (formData.groupFolder || groups.length === 0) return;
    setFormData((prev) => ({
      ...prev,
      groupFolder: groups[0].folder,
      chatJid: groups[0].jid,
    }));
  }, [groups, formData.groupFolder]);

  const toggleWeekday = (
    days: number[],
    setDays: (days: number[]) => void,
    day: number,
  ) => {
    if (days.includes(day)) {
      if (days.length === 1) return;
      setDays(days.filter((d) => d !== day));
      return;
    }
    setDays(uniqueSortedWeekdays([...days, day]));
  };

  const applyTemplate = (template: AutomationTemplate) => {
    const selectedGroup = groups.find((g) => g.folder === formData.groupFolder) || groups[0];
    setFormData((prev) => ({
      ...prev,
      groupFolder: selectedGroup?.folder || prev.groupFolder,
      chatJid: selectedGroup?.jid || prev.chatJid,
      prompt: template.prompt,
      contextMode: template.contextMode,
    }));

    const schedule = parseTemplateSchedule(template);
    setScheduleMode(schedule.mode);
    setDailyTime(schedule.dailyTime);
    setDailyWeekdays(schedule.dailyWeekdays);
    setIntervalNumber(schedule.intervalNumber);
    setIntervalUnit(schedule.intervalUnit);
    setIntervalWeekdays(schedule.intervalWeekdays);
    setOnErrorTodoIngest(template.defaultOnErrorTodoIngest ?? false);
    setOnSuccessDecisionIngest(template.defaultTaskConfig?.on_success?.decision_ingest === true);
    setTaskConfigJson(toTaskConfigJson(template.defaultTaskConfig));

    setErrors((prev) => {
      const next = { ...prev };
      delete next.prompt;
      delete next.scheduleValue;
      delete next.taskConfigJson;
      return next;
    });
  };

  const handleTemplateChoiceChange = (value: string) => {
    setTemplateChoice(value);
    if (value === TEMPLATE_NONE) {
      setTaskConfigJson('');
      return;
    }
    const template = templates.find((item) => item.id === value);
    if (template) applyTemplate(template);
  };

  useEffect(() => {
    if (!initialTemplateId) return;
    const template = templates.find((item) => item.id === initialTemplateId);
    if (!template) return;
    setTemplateChoice(template.id);
    applyTemplate(template);
    // Keep original behavior: only apply initial template when template id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTemplateId]);

  const clearScheduleError = () => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next.scheduleValue;
      return next;
    });
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.groupFolder) {
      newErrors.groupFolder = t('tasks.form.errors.groupRequired');
    }

    if (formData.executionType === 'agent' && !formData.prompt.trim()) {
      newErrors.prompt = t('tasks.form.errors.promptRequired');
    }
    if (formData.executionType === 'script' && !formData.scriptCommand.trim()) {
      newErrors.scriptCommand = t('tasks.form.errors.scriptCommandRequired');
    }

    if (scheduleMode === 'daily') {
      if (!/^\d{2}:\d{2}$/.test(dailyTime)) {
        newErrors.scheduleValue = t('tasks.form.errors.dailyTimeRequired');
      }
      if (dailyWeekdays.length === 0) {
        newErrors.scheduleValue = t('tasks.form.errors.weekdayRequired');
      }
    }

    if (scheduleMode === 'interval') {
      const num = Number.parseInt(intervalNumber, 10);
      if (!Number.isFinite(num) || num <= 0) {
        newErrors.scheduleValue = t('tasks.form.errors.intervalPositive');
      }
      if (intervalUnit === 'minute' && num > 59) {
        newErrors.scheduleValue = t('tasks.form.errors.intervalMinuteMax');
      }
      if (intervalUnit === 'hour' && num > 23) {
        newErrors.scheduleValue = t('tasks.form.errors.intervalHourMax');
      }
      if (intervalWeekdays.length === 0) {
        newErrors.scheduleValue = t('tasks.form.errors.weekdayRequired');
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    let scheduleType: ScheduleType;
    let scheduleValue: string;

    if (scheduleMode === 'daily') {
      scheduleType = 'cron';
      scheduleValue = buildDailyCron(dailyTime, dailyWeekdays);
    } else {
      const num = Number.parseInt(intervalNumber, 10);
      if (intervalWeekdays.length === 7) {
        scheduleType = 'interval';
        scheduleValue = String(num * (intervalUnit === 'minute' ? 60 * 1000 : 60 * 60 * 1000));
      } else {
        scheduleType = 'cron';
        scheduleValue = buildIntervalCron(num, intervalUnit, intervalWeekdays);
      }
    }

    setSubmitting(true);
    try {
      let nextTaskConfig: TaskConfig = {};
      const taskConfigText = taskConfigJson.trim();
      if (taskConfigText) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(taskConfigText);
        } catch {
          setErrors((prev) => ({
            ...prev,
            taskConfigJson: t('tasks.form.errors.taskConfigJsonInvalid'),
          }));
          setSubmitting(false);
          return;
        }
        if (!isPlainObject(parsed)) {
          setErrors((prev) => ({
            ...prev,
            taskConfigJson: t('tasks.form.errors.taskConfigJsonInvalid'),
          }));
          setSubmitting(false);
          return;
        }
        nextTaskConfig = deepMergeObjects({}, parsed) as TaskConfig;
      }
      setErrors((prev) => {
        const next = { ...prev };
        delete next.taskConfigJson;
        return next;
      });
      if (onErrorTodoIngest) {
        const existingOnError =
          nextTaskConfig.on_error
            && typeof nextTaskConfig.on_error === 'object'
            && !Array.isArray(nextTaskConfig.on_error)
            ? nextTaskConfig.on_error as Record<string, unknown>
            : {};
        nextTaskConfig.on_error = {
          ...existingOnError,
          todo_ingest: true,
        };
      } else if (
        nextTaskConfig.on_error
        && typeof nextTaskConfig.on_error === 'object'
        && !Array.isArray(nextTaskConfig.on_error)
      ) {
        const onErrorConfig = { ...(nextTaskConfig.on_error as Record<string, unknown>) };
        delete onErrorConfig.todo_ingest;
        if (Object.keys(onErrorConfig).length > 0) {
          nextTaskConfig.on_error = onErrorConfig;
        } else {
          delete nextTaskConfig.on_error;
        }
      }

      if (onSuccessDecisionIngest) {
        const existingOnSuccess =
          nextTaskConfig.on_success
            && typeof nextTaskConfig.on_success === 'object'
            && !Array.isArray(nextTaskConfig.on_success)
            ? nextTaskConfig.on_success as Record<string, unknown>
            : {};
        nextTaskConfig.on_success = {
          ...existingOnSuccess,
          decision_ingest: true,
        };
      } else if (
        nextTaskConfig.on_success
        && typeof nextTaskConfig.on_success === 'object'
        && !Array.isArray(nextTaskConfig.on_success)
      ) {
        const onSuccessConfig = { ...(nextTaskConfig.on_success as Record<string, unknown>) };
        delete onSuccessConfig.decision_ingest;
        if (Object.keys(onSuccessConfig).length > 0) {
          nextTaskConfig.on_success = onSuccessConfig;
        } else {
          delete nextTaskConfig.on_success;
        }
      }

      await onSubmit({
        ...formData,
        prompt: formData.prompt.trim(),
        scriptCommand: formData.scriptCommand.trim(),
        scheduleType,
        scheduleValue,
        taskConfig: Object.keys(nextTaskConfig).length > 0 ? nextTaskConfig : null,
      });
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGroupChange = (value: string) => {
    const selectedGroup = groups.find((g) => g.folder === value);
    setFormData((prev) => ({
      ...prev,
      groupFolder: value,
      chatJid: selectedGroup?.jid || '',
    }));

    setErrors((prev) => {
      const next = { ...prev };
      delete next.groupFolder;
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="surface-card w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">{t('tasks.form.title')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('tasks.form.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground/80 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label={t('tasks.form.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground/80">
              {t('tasks.form.workspace')} <span className="text-red-500">*</span>
            </label>
            <Select value={formData.groupFolder || undefined} onValueChange={handleGroupChange}>
              <SelectTrigger className={cn('w-full', errors.groupFolder && 'border-red-500')}>
                <SelectValue placeholder={t('tasks.form.choose')} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group.jid} value={group.folder}>
                    {group.name} ({group.folder})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.groupFolder && <p className="text-sm text-red-600">{errors.groupFolder}</p>}
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2 text-sm font-medium text-foreground/85">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-600" />
                {t('tasks.form.templateTitle')}
              </div>
              <span className="text-xs font-normal text-muted-foreground">{t('tasks.form.templateHint')}</span>
            </div>
            <div className="flex flex-col gap-2">
              <Select value={templateChoice} onValueChange={handleTemplateChoiceChange}>
                <SelectTrigger className="flex-1 bg-card">
                  <SelectValue placeholder={t('tasks.form.chooseTemplate')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TEMPLATE_NONE}>{t('tasks.form.noTemplate')}</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground/80">
                {t('tasks.form.executionType')}
              </label>
              <Select
                value={formData.executionType}
                onValueChange={(value) => {
                  setFormData({
                    ...formData,
                    executionType: value as 'agent' | 'script',
                  });
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next.prompt;
                    delete next.scriptCommand;
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">{t('tasks.form.executionAgent')}</SelectItem>
                  <SelectItem value="script">{t('tasks.form.executionScript')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground/80">
              {formData.executionType === 'script'
                ? t('tasks.form.taskDescription')
                : t('tasks.form.prompt')}{' '}
              {formData.executionType === 'agent' && <span className="text-red-500">*</span>}
            </label>
            <Textarea
              value={formData.prompt}
              onChange={(e) => {
                setFormData({ ...formData, prompt: e.target.value });
              }}
              rows={4}
              className={cn('resize-none', errors.prompt && 'border-red-500')}
              placeholder={t('tasks.form.promptPlaceholder')}
            />
            {errors.prompt && <p className="text-sm text-red-600">{errors.prompt}</p>}
          </div>

          {formData.executionType === 'script' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground/80">
                {t('tasks.form.scriptCommand')} <span className="text-red-500">*</span>
              </label>
              <Input
                value={formData.scriptCommand}
                onChange={(e) => {
                  setFormData({ ...formData, scriptCommand: e.target.value });
                }}
                className={cn(errors.scriptCommand && 'border-red-500')}
                placeholder={t('tasks.form.scriptCommandPlaceholder')}
              />
              {errors.scriptCommand && <p className="text-sm text-red-600">{errors.scriptCommand}</p>}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3">
            <label className="block text-sm font-medium text-foreground/80">
              {t('tasks.form.schedule')} <span className="text-red-500">*</span>
            </label>

            <div className="inline-flex rounded-xl border border-border/70 bg-card p-1">
              <button
                type="button"
                onClick={() => {
                  setScheduleMode('daily');
                  clearScheduleError();
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  scheduleMode === 'daily'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {t('tasks.form.modeDaily')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setScheduleMode('interval');
                  clearScheduleError();
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  scheduleMode === 'interval'
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {t('tasks.form.modeInterval')}
              </button>
            </div>

            {scheduleMode === 'daily' && (
              <div className="space-y-3 rounded-lg border border-border/70 bg-card p-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{t('tasks.form.dailyTime')}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    value={dailyTime}
                    onChange={(e) => {
                      setDailyTime(e.target.value);
                      clearScheduleError();
                    }}
                    className="w-[140px]"
                  />
                  <span className="ml-1 text-xs text-muted-foreground">{t('tasks.form.weekday')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {weekdayOptions.map((item) => {
                      const active = dailyWeekdays.includes(item.value);
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => {
                            toggleWeekday(dailyWeekdays, setDailyWeekdays, item.value);
                            clearScheduleError();
                          }}
                          className={cn(
                            'h-7 w-7 rounded-md border text-xs transition-colors',
                            active
                              ? 'border-brand-200 bg-brand-50 text-brand-700'
                              : 'border-border/70 bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          )}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {scheduleMode === 'interval' && (
              <div className="space-y-2 rounded-lg border border-border/70 bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{t('tasks.form.interval')}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    value={intervalNumber}
                    onChange={(e) => {
                      setIntervalNumber(e.target.value);
                      clearScheduleError();
                    }}
                    className="w-[110px]"
                    placeholder={t('tasks.form.intervalValue')}
                  />
                  <Select
                    value={intervalUnit}
                    onValueChange={(value) => {
                      setIntervalUnit(value as IntervalUnit);
                      clearScheduleError();
                    }}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minute">{t('tasks.form.unitMinute')}</SelectItem>
                      <SelectItem value="hour">{t('tasks.form.unitHour')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="ml-1 text-xs text-muted-foreground">{t('tasks.form.weekday')}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {weekdayOptions.map((item) => {
                      const active = intervalWeekdays.includes(item.value);
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => {
                            toggleWeekday(intervalWeekdays, setIntervalWeekdays, item.value);
                            clearScheduleError();
                          }}
                          className={cn(
                            'h-7 w-7 rounded-md border text-xs transition-colors',
                            active
                              ? 'border-brand-200 bg-brand-50 text-brand-700'
                              : 'border-border/70 bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                          )}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {errors.scheduleValue && <p className="text-sm text-red-600">{errors.scheduleValue}</p>}
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground/80">{t('tasks.form.contextMode')}</label>
            <Select
              value={formData.contextMode}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  contextMode: value as ContextMode,
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="isolated">{t('tasks.form.contextIsolated')}</SelectItem>
                <SelectItem value="group">{t('tasks.form.contextGroup')}</SelectItem>
              </SelectContent>
            </Select>
            {formData.executionType !== 'script' && (
              <p className="text-xs text-muted-foreground">{t('tasks.form.contextHint')}</p>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3">
            <div className="text-sm font-medium text-foreground/80">{t('tasks.form.failureRuleTitle')}</div>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={onErrorTodoIngest}
                onChange={(e) => setOnErrorTodoIngest(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <span>{t('tasks.form.onErrorTodoIngest')}</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('tasks.form.onErrorTodoIngestHint')}</p>
          </div>

          <div className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3">
            <div className="text-sm font-medium text-foreground/80">{t('tasks.form.successRuleTitle')}</div>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={onSuccessDecisionIngest}
                onChange={(e) => setOnSuccessDecisionIngest(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border"
              />
              <span>{t('tasks.form.onSuccessDecisionIngest')}</span>
            </label>
            <p className="text-xs text-muted-foreground">{t('tasks.form.onSuccessDecisionIngestHint')}</p>
          </div>

          <div className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3">
            <div className="text-sm font-medium text-foreground/80">{t('tasks.form.taskConfigJsonTitle')}</div>
            <p className="text-xs text-muted-foreground">{t('tasks.form.taskConfigJsonHint')}</p>
            <Textarea
              value={taskConfigJson}
              onChange={(e) => {
                setTaskConfigJson(e.target.value);
                setErrors((prev) => {
                  const next = { ...prev };
                  delete next.taskConfigJson;
                  return next;
                });
              }}
              rows={6}
              className={cn('resize-y font-mono text-xs', errors.taskConfigJson && 'border-red-500')}
              placeholder={t('tasks.form.taskConfigJsonPlaceholder')}
            />
            {errors.taskConfigJson && <p className="text-sm text-red-600">{errors.taskConfigJson}</p>}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('tasks.form.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? t('tasks.form.creating') : t('tasks.form.create')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
