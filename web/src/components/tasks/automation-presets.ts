import type { MessageKey } from '../../i18n';

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

interface AutomationTemplateDefinition {
  id: string;
  nameKey: MessageKey;
  summaryKey: MessageKey;
  cadenceKey: MessageKey;
  promptKey: MessageKey;
  scheduleType: ScheduleType;
  scheduleValue: string;
  contextMode: ContextMode;
}

interface SchedulePresetDefinition {
  id: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  mode: SchedulePreset['mode'];
  count?: number;
  unitMs?: number;
  cron?: string;
  offsetMinutes?: number;
  hour?: number;
  minute?: number;
}

export const INTERVAL_UNITS = [
  { label: '秒', ms: 1000 },
  { label: '分钟', ms: 60 * 1000 },
  { label: '小时', ms: 60 * 60 * 1000 },
  { label: '天', ms: 24 * 60 * 60 * 1000 },
] as const;

const AUTOMATION_TEMPLATE_DEFS: AutomationTemplateDefinition[] = [
  {
    id: 'daily-brief',
    nameKey: 'tasks.templates.dailyBrief.name',
    summaryKey: 'tasks.templates.dailyBrief.summary',
    cadenceKey: 'tasks.templates.dailyBrief.cadence',
    promptKey: 'tasks.templates.dailyBrief.prompt',
    scheduleType: 'cron',
    scheduleValue: '0 9 * * *',
    contextMode: 'group',
  },
  {
    id: 'weekday-standup',
    nameKey: 'tasks.templates.weekdayStandup.name',
    summaryKey: 'tasks.templates.weekdayStandup.summary',
    cadenceKey: 'tasks.templates.weekdayStandup.cadence',
    promptKey: 'tasks.templates.weekdayStandup.prompt',
    scheduleType: 'cron',
    scheduleValue: '0 18 * * 1-5',
    contextMode: 'group',
  },
  {
    id: 'release-watch',
    nameKey: 'tasks.templates.releaseWatch.name',
    summaryKey: 'tasks.templates.releaseWatch.summary',
    cadenceKey: 'tasks.templates.releaseWatch.cadence',
    promptKey: 'tasks.templates.releaseWatch.prompt',
    scheduleType: 'interval',
    scheduleValue: String(30 * 60 * 1000),
    contextMode: 'isolated',
  },
  {
    id: 'error-digest',
    nameKey: 'tasks.templates.errorDigest.name',
    summaryKey: 'tasks.templates.errorDigest.summary',
    cadenceKey: 'tasks.templates.errorDigest.cadence',
    promptKey: 'tasks.templates.errorDigest.prompt',
    scheduleType: 'interval',
    scheduleValue: String(10 * 60 * 1000),
    contextMode: 'isolated',
  },
  {
    id: 'weekly-retro',
    nameKey: 'tasks.templates.weeklyRetro.name',
    summaryKey: 'tasks.templates.weeklyRetro.summary',
    cadenceKey: 'tasks.templates.weeklyRetro.cadence',
    promptKey: 'tasks.templates.weeklyRetro.prompt',
    scheduleType: 'cron',
    scheduleValue: '0 17 * * 5',
    contextMode: 'group',
  },
  {
    id: 'code-health',
    nameKey: 'tasks.templates.codeHealth.name',
    summaryKey: 'tasks.templates.codeHealth.summary',
    cadenceKey: 'tasks.templates.codeHealth.cadence',
    promptKey: 'tasks.templates.codeHealth.prompt',
    scheduleType: 'cron',
    scheduleValue: '0 10 * * 1-5',
    contextMode: 'isolated',
  },
];

export function getAutomationTemplates(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): AutomationTemplate[] {
  return AUTOMATION_TEMPLATE_DEFS.map((def) => ({
    id: def.id,
    name: t(def.nameKey),
    summary: t(def.summaryKey),
    cadence: t(def.cadenceKey),
    prompt: t(def.promptKey),
    scheduleType: def.scheduleType,
    scheduleValue: def.scheduleValue,
    contextMode: def.contextMode,
  }));
}

const SCHEDULE_PRESET_DEFS: SchedulePresetDefinition[] = [
  {
    id: 'q10m',
    labelKey: 'tasks.presets.q10m.label',
    hintKey: 'tasks.presets.q10m.hint',
    mode: 'interval',
    count: 10,
    unitMs: 60 * 1000,
  },
  {
    id: 'q30m',
    labelKey: 'tasks.presets.q30m.label',
    hintKey: 'tasks.presets.q30m.hint',
    mode: 'interval',
    count: 30,
    unitMs: 60 * 1000,
  },
  {
    id: 'q1h',
    labelKey: 'tasks.presets.q1h.label',
    hintKey: 'tasks.presets.q1h.hint',
    mode: 'interval',
    count: 1,
    unitMs: 60 * 60 * 1000,
  },
  {
    id: 'd0900',
    labelKey: 'tasks.presets.d0900.label',
    hintKey: 'tasks.presets.d0900.hint',
    mode: 'cron',
    cron: '0 9 * * *',
  },
  {
    id: 'wkd0900',
    labelKey: 'tasks.presets.wkd0900.label',
    hintKey: 'tasks.presets.wkd0900.hint',
    mode: 'cron',
    cron: '0 9 * * 1-5',
  },
  {
    id: 'once30m',
    labelKey: 'tasks.presets.once30m.label',
    hintKey: 'tasks.presets.once30m.hint',
    mode: 'once-offset',
    offsetMinutes: 30,
  },
  {
    id: 'once2h',
    labelKey: 'tasks.presets.once2h.label',
    hintKey: 'tasks.presets.once2h.hint',
    mode: 'once-offset',
    offsetMinutes: 120,
  },
  {
    id: 'once-tomorrow-9',
    labelKey: 'tasks.presets.onceTomorrow9.label',
    hintKey: 'tasks.presets.onceTomorrow9.hint',
    mode: 'once-tomorrow',
    hour: 9,
    minute: 0,
  },
];

export function getSchedulePresets(
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): SchedulePreset[] {
  return SCHEDULE_PRESET_DEFS.map((def) => ({
    id: def.id,
    label: t(def.labelKey),
    hint: t(def.hintKey),
    mode: def.mode,
    ...(def.count !== undefined ? { count: def.count } : {}),
    ...(def.unitMs !== undefined ? { unitMs: def.unitMs } : {}),
    ...(def.cron !== undefined ? { cron: def.cron } : {}),
    ...(def.offsetMinutes !== undefined ? { offsetMinutes: def.offsetMinutes } : {}),
    ...(def.hour !== undefined ? { hour: def.hour } : {}),
    ...(def.minute !== undefined ? { minute: def.minute } : {}),
  }));
}

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

export function parseHumanSchedule(
  input: string,
  now = new Date(),
): ParsedSchedule | null {
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
