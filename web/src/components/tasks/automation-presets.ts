export type ScheduleType = 'cron' | 'interval' | 'once';
export type ContextMode = 'group' | 'isolated';

export interface AutomationTemplate {
  id: string;
  name: string;
  summary: string;
  cadence: string;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  contextMode: ContextMode;
}

export interface SchedulePreset {
  id: string;
  label: string;
  hint: string;
  mode: 'interval' | 'cron' | 'once-offset' | 'once-tomorrow';
  count?: number;
  unitMs?: number;
  cron?: string;
  offsetMinutes?: number;
  hour?: number;
  minute?: number;
}

export interface ParsedSchedule {
  type: ScheduleType;
  value: string;
  label: string;
}

export const INTERVAL_UNITS = [
  { label: '秒', ms: 1000 },
  { label: '分钟', ms: 60 * 1000 },
  { label: '小时', ms: 60 * 60 * 1000 },
  { label: '天', ms: 24 * 60 * 60 * 1000 },
] as const;

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'daily-brief',
    name: '每日晨报',
    summary: '汇总最近 24 小时关键进展和风险。',
    cadence: '每天 09:00',
    prompt:
      '整理过去24小时工作区内的关键进展、阻塞项和待决策问题，输出简洁晨报并附带优先级建议。',
    scheduleType: 'cron',
    scheduleValue: '0 9 * * *',
    contextMode: 'group',
  },
  {
    id: 'weekday-standup',
    name: '工作日站会摘要',
    summary: '工作日定时生成可读的站会摘要。',
    cadence: '工作日 18:00',
    prompt:
      '提取今天的任务推进情况，按“已完成 / 进行中 / 阻塞”输出站会摘要，并给出明日优先建议。',
    scheduleType: 'cron',
    scheduleValue: '0 18 * * 1-5',
    contextMode: 'group',
  },
  {
    id: 'release-watch',
    name: '发布巡检',
    summary: '定期巡检发布相关日志与告警。',
    cadence: '每 30 分钟',
    prompt:
      '检查最近发布流水线、错误日志和告警状态，标记异常并给出处置建议。若无异常，回复“巡检正常”。',
    scheduleType: 'interval',
    scheduleValue: String(30 * 60 * 1000),
    contextMode: 'isolated',
  },
  {
    id: 'error-digest',
    name: '错误聚合速报',
    summary: '高频聚合错误与失败任务，快速定位风险。',
    cadence: '每 10 分钟',
    prompt:
      '汇总近10分钟新增错误、失败任务和高频异常，按影响面排序输出并附恢复建议。',
    scheduleType: 'interval',
    scheduleValue: String(10 * 60 * 1000),
    contextMode: 'isolated',
  },
  {
    id: 'weekly-retro',
    name: '周复盘草稿',
    summary: '每周自动生成复盘草稿。',
    cadence: '每周五 17:00',
    prompt:
      '基于本周会话和任务执行记录，生成周复盘草稿：目标完成度、风险、下周计划与改进建议。',
    scheduleType: 'cron',
    scheduleValue: '0 17 * * 5',
    contextMode: 'group',
  },
  {
    id: 'code-health',
    name: '代码健康巡检',
    summary: '关注代码变更、测试和构建状态。',
    cadence: '工作日 10:00',
    prompt:
      '检查近期代码变更、测试结果与构建状态，输出潜在风险与建议动作，按优先级排序。',
    scheduleType: 'cron',
    scheduleValue: '0 10 * * 1-5',
    contextMode: 'isolated',
  },
];

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: 'q10m', label: '每 10 分钟', hint: '高频巡检', mode: 'interval', count: 10, unitMs: 60 * 1000 },
  { id: 'q30m', label: '每 30 分钟', hint: '常规轮询', mode: 'interval', count: 30, unitMs: 60 * 1000 },
  { id: 'q1h', label: '每 1 小时', hint: '小时级检查', mode: 'interval', count: 1, unitMs: 60 * 60 * 1000 },
  { id: 'd0900', label: '每天 09:00', hint: '日报/晨报', mode: 'cron', cron: '0 9 * * *' },
  { id: 'wkd0900', label: '工作日 09:00', hint: '工作日任务', mode: 'cron', cron: '0 9 * * 1-5' },
  { id: 'once30m', label: '30 分钟后', hint: '一次性执行', mode: 'once-offset', offsetMinutes: 30 },
  { id: 'once2h', label: '2 小时后', hint: '一次性执行', mode: 'once-offset', offsetMinutes: 120 },
  { id: 'once-tomorrow-9', label: '明天 09:00', hint: '一次性执行', mode: 'once-tomorrow', hour: 9, minute: 0 },
];

export function toLocalDateTimeInput(date: Date): string {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toIntervalFields(msText: string): { number: string; unit: string } {
  const parsed = Number.parseInt(msText, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { number: '10', unit: String(60 * 1000) };
  }

  const unitOrder = [...INTERVAL_UNITS].sort((a, b) => b.ms - a.ms);
  for (const unit of unitOrder) {
    if (parsed % unit.ms === 0) {
      return { number: String(parsed / unit.ms), unit: String(unit.ms) };
    }
  }

  return { number: String(parsed), unit: String(1000) };
}

function clampTime(hour: number, minute: number): { hour: number; minute: number } | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function buildDateFromNow(now: Date, dayOffset: number, hour: number, minute: number) {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function parseDateTimeString(input: string): Date | null {
  const normalized = input.trim().replace(/\//g, '-');
  const matched = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})$/);
  if (!matched) return null;
  const [, y, mo, d, h, mi] = matched;
  const year = Number.parseInt(y, 10);
  const month = Number.parseInt(mo, 10);
  const day = Number.parseInt(d, 10);
  const hour = Number.parseInt(h, 10);
  const minute = Number.parseInt(mi, 10);
  const checked = clampTime(hour, minute);
  if (!checked) return null;
  const date = new Date(year, month - 1, day, checked.hour, checked.minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseHumanSchedule(input: string, now = new Date()): ParsedSchedule | null {
  const raw = input.trim().replace(/\s+/g, '');
  if (!raw) return null;

  const intervalMatched = raw.match(/^每(\d+)(秒|分钟|小时|天)$/);
  if (intervalMatched) {
    const count = Number.parseInt(intervalMatched[1], 10);
    const unit = intervalMatched[2];
    if (count <= 0) return null;
    const unitMs =
      unit === '秒'
        ? 1000
        : unit === '分钟'
          ? 60 * 1000
          : unit === '小时'
            ? 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
    return {
      type: 'interval',
      value: String(count * unitMs),
      label: `每 ${count} ${unit}`,
    };
  }

  const afterMatched = raw.match(/^(\d+)(分钟|小时|天)后$/);
  if (afterMatched) {
    const count = Number.parseInt(afterMatched[1], 10);
    const unit = afterMatched[2];
    if (count <= 0) return null;
    const minutes =
      unit === '分钟'
        ? count
        : unit === '小时'
          ? count * 60
          : count * 24 * 60;
    const date = new Date(now.getTime() + minutes * 60 * 1000);
    return {
      type: 'once',
      value: date.toISOString(),
      label: `${count}${unit}后`,
    };
  }

  const dailyMatched = raw.match(/^每天(\d{1,2})(?::(\d{1,2}))?$/);
  if (dailyMatched) {
    const hour = Number.parseInt(dailyMatched[1], 10);
    const minute = Number.parseInt(dailyMatched[2] || '0', 10);
    const checked = clampTime(hour, minute);
    if (!checked) return null;
    return {
      type: 'cron',
      value: `${checked.minute} ${checked.hour} * * *`,
      label: `每天 ${String(checked.hour).padStart(2, '0')}:${String(checked.minute).padStart(2, '0')}`,
    };
  }

  const weekdaysMatched = raw.match(/^工作日(\d{1,2})(?::(\d{1,2}))?$/);
  if (weekdaysMatched) {
    const hour = Number.parseInt(weekdaysMatched[1], 10);
    const minute = Number.parseInt(weekdaysMatched[2] || '0', 10);
    const checked = clampTime(hour, minute);
    if (!checked) return null;
    return {
      type: 'cron',
      value: `${checked.minute} ${checked.hour} * * 1-5`,
      label: `工作日 ${String(checked.hour).padStart(2, '0')}:${String(checked.minute).padStart(2, '0')}`,
    };
  }

  const weeklyMatched = raw.match(/^每周([一二三四五六日天])(\d{1,2})(?::(\d{1,2}))?$/);
  if (weeklyMatched) {
    const dayMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      日: 0,
      天: 0,
    };
    const day = dayMap[weeklyMatched[1]];
    const hour = Number.parseInt(weeklyMatched[2], 10);
    const minute = Number.parseInt(weeklyMatched[3] || '0', 10);
    const checked = clampTime(hour, minute);
    if (!checked) return null;
    return {
      type: 'cron',
      value: `${checked.minute} ${checked.hour} * * ${day}`,
      label: `每周${weeklyMatched[1]} ${String(checked.hour).padStart(2, '0')}:${String(checked.minute).padStart(2, '0')}`,
    };
  }

  const tomorrowMatched = raw.match(/^明天(\d{1,2})(?::(\d{1,2}))?$/);
  if (tomorrowMatched) {
    const hour = Number.parseInt(tomorrowMatched[1], 10);
    const minute = Number.parseInt(tomorrowMatched[2] || '0', 10);
    const checked = clampTime(hour, minute);
    if (!checked) return null;
    const date = buildDateFromNow(now, 1, checked.hour, checked.minute);
    return {
      type: 'once',
      value: date.toISOString(),
      label: `明天 ${String(checked.hour).padStart(2, '0')}:${String(checked.minute).padStart(2, '0')}`,
    };
  }

  const parsedDate = parseDateTimeString(raw);
  if (parsedDate) {
    return {
      type: 'once',
      value: parsedDate.toISOString(),
      label: `${parsedDate.getFullYear()}-${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')} ${String(parsedDate.getHours()).padStart(2, '0')}:${String(parsedDate.getMinutes()).padStart(2, '0')}`,
    };
  }

  return null;
}
