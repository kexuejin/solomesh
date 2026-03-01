import { useEffect, useState } from 'react';
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
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
  type ContextMode,
  type ScheduleType,
} from './automation-presets';

interface Group {
  jid: string;
  name: string;
  folder: string;
}

interface CreateTaskFormProps {
  groups: Group[];
  initialTemplateId?: string | null;
  onSubmit: (data: {
    groupFolder: string;
    chatJid: string;
    prompt: string;
    scheduleType: ScheduleType;
    scheduleValue: string;
    contextMode: ContextMode;
  }) => Promise<void>;
  onClose: () => void;
}

type ScheduleMode = 'daily' | 'interval';
type IntervalUnit = 'minute' | 'hour';

const WEEKDAY_OPTIONS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 0 },
] as const;

const ALL_WEEKDAYS = WEEKDAY_OPTIONS.map((item) => item.value);
const WORKDAYS = [1, 2, 3, 4, 5];
const TEMPLATE_NONE = '__none__';

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

export function CreateTaskForm({ groups, initialTemplateId, onSubmit, onClose }: CreateTaskFormProps) {
  const [formData, setFormData] = useState({
    groupFolder: groups[0]?.folder || '',
    chatJid: groups[0]?.jid || '',
    prompt: '',
    scheduleType: 'cron' as ScheduleType,
    scheduleValue: '',
    contextMode: 'isolated' as ContextMode,
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

    setErrors((prev) => {
      const next = { ...prev };
      delete next.prompt;
      delete next.scheduleValue;
      return next;
    });
  };

  const handleTemplateChoiceChange = (value: string) => {
    setTemplateChoice(value);
    if (value === TEMPLATE_NONE) return;
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === value);
    if (template) applyTemplate(template);
  };

  useEffect(() => {
    if (!initialTemplateId) return;
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === initialTemplateId);
    if (!template) return;
    setTemplateChoice(template.id);
    applyTemplate(template);
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
      newErrors.groupFolder = '请选择群组';
    }

    if (!formData.prompt.trim()) {
      newErrors.prompt = '请输入自动化指令';
    }

    if (scheduleMode === 'daily') {
      if (!/^\d{2}:\d{2}$/.test(dailyTime)) {
        newErrors.scheduleValue = '请选择每天执行时间';
      }
      if (dailyWeekdays.length === 0) {
        newErrors.scheduleValue = '请至少选择一天';
      }
    }

    if (scheduleMode === 'interval') {
      const num = Number.parseInt(intervalNumber, 10);
      if (!Number.isFinite(num) || num <= 0) {
        newErrors.scheduleValue = '间隔必须是正整数';
      }
      if (intervalUnit === 'minute' && num > 59) {
        newErrors.scheduleValue = '分钟间隔最大支持 59（超过请改用小时）';
      }
      if (intervalUnit === 'hour' && num > 23) {
        newErrors.scheduleValue = '小时间隔最大支持 23';
      }
      if (intervalWeekdays.length === 0) {
        newErrors.scheduleValue = '请至少选择一天';
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
      await onSubmit({
        ...formData,
        prompt: formData.prompt.trim(),
        scheduleType,
        scheduleValue,
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
            <h2 className="text-xl font-bold text-foreground">新建自动化</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">模板 + 两种直观调度方式</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground/80 transition-colors hover:bg-muted hover:text-muted-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground/80">
              工作区 <span className="text-red-500">*</span>
            </label>
            <Select value={formData.groupFolder || undefined} onValueChange={handleGroupChange}>
              <SelectTrigger className={cn('w-full', errors.groupFolder && 'border-red-500')}>
                <SelectValue placeholder="请选择" />
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
                自动化模板（可选）
              </div>
              <span className="text-xs font-normal text-muted-foreground">选择后自动填充，可继续修改</span>
            </div>
            <div className="flex flex-col gap-2">
              <Select value={templateChoice} onValueChange={handleTemplateChoiceChange}>
                <SelectTrigger className="flex-1 bg-card">
                  <SelectValue placeholder="选择模板" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TEMPLATE_NONE}>不使用模板</SelectItem>
                  {AUTOMATION_TEMPLATES.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground/80">
              自动化指令 <span className="text-red-500">*</span>
            </label>
            <Textarea
              value={formData.prompt}
              onChange={(e) => {
                setFormData({ ...formData, prompt: e.target.value });
              }}
              rows={4}
              className={cn('resize-none', errors.prompt && 'border-red-500')}
              placeholder="例如：每天早上汇总昨日新增问题，按优先级排序并给出建议"
            />
            {errors.prompt && <p className="text-sm text-red-600">{errors.prompt}</p>}
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-3">
            <label className="block text-sm font-medium text-foreground/80">
              调度方式 <span className="text-red-500">*</span>
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
                每天
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
                时间间隔
              </button>
            </div>

            {scheduleMode === 'daily' && (
              <div className="space-y-3 rounded-lg border border-border/70 bg-card p-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">每天执行时间</span>
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
                  <span className="ml-1 text-xs text-muted-foreground">周几</span>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_OPTIONS.map((item) => {
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
                    <span className="text-sm font-medium text-foreground">执行间隔</span>
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
                    placeholder="数值"
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
                      <SelectItem value="minute">分钟</SelectItem>
                      <SelectItem value="hour">小时</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="ml-1 text-xs text-muted-foreground">周几</span>
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_OPTIONS.map((item) => {
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
            <label className="block text-sm font-medium text-foreground/80">上下文模式</label>
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
                <SelectItem value="isolated">独立执行（推荐）</SelectItem>
                <SelectItem value="group">共享群组上下文</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">共享群组上下文会复用该群组会话，独立执行每次使用隔离会话。</p>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {submitting ? '创建中...' : '创建自动化'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
