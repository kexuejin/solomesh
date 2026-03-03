import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock3, Loader2, Sparkles, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '../../api/client';
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
import { extractErrorMessage } from '../../lib/error-message';
import { DEFAULT_RUNTIME_DEFINITIONS, type AgentRuntimeId } from '../../runtime-definitions';

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
    operationPermissionMode: 'default' | 'bypass';
    agentRuntimeOverride: AgentRuntimeId | null;
    executionEnvironment: 'local' | 'worktree';
    executionType: 'agent' | 'script';
    scriptCommand: string;
    skillRefs: string[];
  }) => Promise<void>;
  onClose: () => void;
}

interface WorkflowIdeaOptimizeResponse {
  provider: 'claude' | 'codex' | 'gemini';
  optimizedIdea: string;
}

interface SkillInstallCandidate {
  package: string;
  installs?: string;
  description?: string;
}

interface TaskDependencyDetails {
  missingSkillRefs: string[];
  invalidSkillRefs: string[];
  availableSkillRefs: string[];
  skillInstallOptions: Record<string, string[]>;
  skillInstallCandidates: Record<string, SkillInstallCandidate[]>;
}

interface TaskSubmitPayload {
  groupFolder: string;
  chatJid: string;
  prompt: string;
  scheduleType: ScheduleType;
  scheduleValue: string;
  contextMode: ContextMode;
  operationPermissionMode: 'default' | 'bypass';
  agentRuntimeOverride: AgentRuntimeId | null;
  executionEnvironment: 'local' | 'worktree';
  executionType: 'agent' | 'script';
  scriptCommand: string;
  skillRefs: string[];
}

type ScheduleMode = 'daily' | 'interval';
type IntervalUnit = 'minute' | 'hour';

const WEEKDAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;
const ALL_WEEKDAYS = [...WEEKDAY_VALUES];
const WORKDAYS = [1, 2, 3, 4, 5];
const TEMPLATE_NONE = '__none__';
const SKILL_REF_RE = /^[\w-]+$/;

function normalizeSkillRef(value: string): string {
  return value.trim().toLowerCase();
}

function parseSkillRefsInput(value: string): string[] {
  const tokens = value
    .split(/[\n,]+/)
    .map((item) => normalizeSkillRef(item))
    .filter((item) => item.length > 0);
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    deduped.push(token);
  }
  return deduped;
}

function validateSkillRefs(skillRefs: string[]): string[] {
  return skillRefs.filter((ref) => !SKILL_REF_RE.test(ref));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? normalizeSkillRef(item) : ''))
    .filter((item) => item.length > 0);
}

function toStringArrayMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, string[]> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeSkillRef(rawKey);
    if (!key) continue;
    result[key] = Array.from(new Set(toStringArray(rawValue)));
  }
  return result;
}

function toSkillInstallCandidatesMap(value: unknown): TaskDependencyDetails['skillInstallCandidates'] {
  if (!value || typeof value !== 'object') return {};
  const result: TaskDependencyDetails['skillInstallCandidates'] = {};
  for (const [rawSkillRef, rawCandidates] of Object.entries(value as Record<string, unknown>)) {
    const skillRef = normalizeSkillRef(rawSkillRef);
    if (!skillRef || !Array.isArray(rawCandidates)) continue;
    const dedup = new Set<string>();
    const candidates: SkillInstallCandidate[] = [];
    for (const raw of rawCandidates) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const pkg = typeof item.package === 'string' ? item.package.trim() : '';
      if (!pkg || dedup.has(pkg)) continue;
      dedup.add(pkg);
      candidates.push({
        package: pkg,
        ...(typeof item.installs === 'string' && item.installs.trim()
          ? { installs: item.installs.trim() }
          : {}),
        ...(typeof item.description === 'string' && item.description.trim()
          ? { description: item.description.trim() }
          : {}),
      });
    }
    result[skillRef] = candidates;
  }
  return result;
}

function parseTaskDependencyDetails(err: unknown): TaskDependencyDetails | null {
  if (!err || typeof err !== 'object' || !('details' in err)) return null;
  const details = (err as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const payload = details as Record<string, unknown>;
  const missingSkillRefs = toStringArray(payload.missingSkillRefs);
  const invalidSkillRefs = toStringArray(payload.invalidSkillRefs);
  const availableSkillRefs = toStringArray(payload.availableSkillRefs);
  if (missingSkillRefs.length === 0 && invalidSkillRefs.length === 0) return null;
  const skillInstallOptions = toStringArrayMap(payload.skillInstallOptions);
  const skillInstallCandidates = toSkillInstallCandidatesMap(payload.skillInstallCandidates);
  for (const skillRef of missingSkillRefs) {
    const options = skillInstallOptions[skillRef] ?? [];
    if (!skillInstallCandidates[skillRef] || skillInstallCandidates[skillRef].length === 0) {
      skillInstallCandidates[skillRef] = options.map((pkg) => ({ package: pkg }));
    }
    skillInstallOptions[skillRef] = skillInstallCandidates[skillRef].map((candidate) => candidate.package);
  }
  return {
    missingSkillRefs,
    invalidSkillRefs,
    availableSkillRefs,
    skillInstallOptions,
    skillInstallCandidates,
  };
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
    operationPermissionMode: 'default' as 'default' | 'bypass',
    agentRuntimeOverride: null as AgentRuntimeId | null,
    executionEnvironment: 'local' as 'local' | 'worktree',
    executionType: 'agent' as 'agent' | 'script',
    scriptCommand: '',
  });
  const [skillRefsInput, setSkillRefsInput] = useState('');

  const [templateChoice, setTemplateChoice] = useState<string>(TEMPLATE_NONE);

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('daily');
  const [dailyTime, setDailyTime] = useState('09:00');
  const [dailyWeekdays, setDailyWeekdays] = useState<number[]>([...WORKDAYS]);

  const [intervalNumber, setIntervalNumber] = useState('30');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('minute');
  const [intervalWeekdays, setIntervalWeekdays] = useState<number[]>([...WORKDAYS]);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [optimizingPrompt, setOptimizingPrompt] = useState(false);
  const [installingMissingSkills, setInstallingMissingSkills] = useState(false);
  const [dependencyDetails, setDependencyDetails] = useState<TaskDependencyDetails | null>(null);
  const [installSelections, setInstallSelections] = useState<Record<string, string>>({});
  const [pendingSubmitPayload, setPendingSubmitPayload] = useState<TaskSubmitPayload | null>(null);
  const runtimeOptions = DEFAULT_RUNTIME_DEFINITIONS;

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

  useEffect(() => {
    if (dependencyDetails || errors.scriptCommand || errors.skillRefs) {
      setIsAdvancedOpen(true);
    }
  }, [dependencyDetails, errors.scriptCommand, errors.skillRefs]);

  const clearScheduleError = () => {
    setErrors((prev) => {
      const next = { ...prev };
      delete next.scheduleValue;
      return next;
    });
  };

  const validateForm = (): { ok: boolean; skillRefs: string[] } => {
    const newErrors: Record<string, string> = {};
    const skillRefs = parseSkillRefsInput(skillRefsInput);
    const invalidSkillRefs = validateSkillRefs(skillRefs);

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

    if (invalidSkillRefs.length > 0) {
      newErrors.skillRefs = t('tasks.form.errors.skillRefsInvalidFormat', {
        refs: invalidSkillRefs.join(', '),
      });
    }

    setErrors(newErrors);
    return {
      ok: Object.keys(newErrors).length === 0,
      skillRefs,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validated = validateForm();
    if (!validated.ok) return;

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

    const payload: TaskSubmitPayload = {
      ...formData,
      prompt: formData.prompt.trim(),
      scriptCommand: formData.scriptCommand.trim(),
      scheduleType,
      scheduleValue,
      skillRefs: validated.skillRefs,
    };

    setPendingSubmitPayload(payload);
    setDependencyDetails(null);
    setInstallSelections({});
    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (error) {
      const dependency = parseTaskDependencyDetails(error);
      if (dependency) {
        const nextSelections: Record<string, string> = {};
        for (const skillRef of dependency.missingSkillRefs) {
          const options = dependency.skillInstallOptions[skillRef] ?? [];
          if (options.length === 1) nextSelections[skillRef] = options[0]!;
        }
        setDependencyDetails(dependency);
        setInstallSelections(nextSelections);
        const errorParts: string[] = [];
        if (dependency.missingSkillRefs.length > 0) {
          errorParts.push(t('tasks.form.errors.dependencyMissingSkills', {
            refs: dependency.missingSkillRefs.join(', '),
          }));
        }
        if (dependency.invalidSkillRefs.length > 0) {
          errorParts.push(t('tasks.form.errors.dependencyInvalidSkills', {
            refs: dependency.invalidSkillRefs.join(', '),
          }));
        }
        setErrors((prev) => ({
          ...prev,
          submit: errorParts.join('；'),
        }));
      } else {
        setErrors((prev) => ({
          ...prev,
          submit: extractErrorMessage(error) ?? t('tasks.form.errors.createFailed'),
        }));
      }
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

  const handleOptimizePromptWithAi = async () => {
    const prompt = formData.prompt.trim();
    if (prompt.length < 8) {
      setErrors((prev) => ({ ...prev, prompt: t('tasks.form.errors.promptOptimizeTooShort') }));
      return;
    }

    setOptimizingPrompt(true);
    try {
      const resp = await api.post<WorkflowIdeaOptimizeResponse>(
        '/api/workflows/templates/idea-optimize',
        {
          idea: prompt,
          ...(formData.chatJid ? { chatJid: formData.chatJid } : {}),
        },
        600_000,
      );
      setFormData((prev) => ({ ...prev, prompt: resp.optimizedIdea }));
      setErrors((prev) => {
        const next = { ...prev };
        delete next.prompt;
        return next;
      });
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        prompt: extractErrorMessage(err) ?? t('tasks.form.errors.promptOptimizeFailed'),
      }));
    } finally {
      setOptimizingPrompt(false);
    }
  };

  const handleInstallMissingSkillsAndRetry = async () => {
    if (!dependencyDetails || !pendingSubmitPayload) return;

    const unresolvedRefs: string[] = [];
    const noCandidateRefs: string[] = [];
    const selectedPackages: Record<string, string> = {};
    for (const skillRef of dependencyDetails.missingSkillRefs) {
      const options = dependencyDetails.skillInstallOptions[skillRef] ?? [];
      if (options.length === 0) {
        noCandidateRefs.push(skillRef);
        continue;
      }
      const selected = (installSelections[skillRef] ?? '').trim();
      if (!selected) {
        unresolvedRefs.push(skillRef);
        continue;
      }
      selectedPackages[skillRef] = selected;
    }
    if (noCandidateRefs.length > 0) {
      setErrors((prev) => ({
        ...prev,
        submit: t('tasks.form.errors.dependencyNoInstallCandidates', {
          refs: noCandidateRefs.join(', '),
        }),
      }));
      return;
    }
    if (unresolvedRefs.length > 0) {
      setErrors((prev) => ({
        ...prev,
        submit: t('tasks.form.errors.dependencyInstallSelectionRequired', {
          refs: unresolvedRefs.join(', '),
        }),
      }));
      return;
    }

    setInstallingMissingSkills(true);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.submit;
      return next;
    });
    try {
      for (const pkg of Object.values(selectedPackages)) {
        await api.post('/api/skills/install', { package: pkg }, 60_000);
      }
      await onSubmit(pendingSubmitPayload);
    } catch (error) {
      const dependency = parseTaskDependencyDetails(error);
      if (dependency) {
        const nextSelections: Record<string, string> = {};
        for (const skillRef of dependency.missingSkillRefs) {
          const options = dependency.skillInstallOptions[skillRef] ?? [];
          if (options.length === 1) nextSelections[skillRef] = options[0]!;
        }
        setDependencyDetails(dependency);
        setInstallSelections(nextSelections);
      }
      setErrors((prev) => ({
        ...prev,
        submit: extractErrorMessage(error) ?? t('tasks.form.errors.installAndRetryFailed'),
      }));
    } finally {
      setInstallingMissingSkills(false);
    }
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

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid gap-4 md:grid-cols-2">
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

            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2 text-sm font-medium text-foreground/85">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand-600" />
                  {t('tasks.form.templateTitle')}
                </div>
                <span className="text-xs font-normal text-muted-foreground">
                  {t('tasks.form.templateHint')}
                </span>
              </div>
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

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground/80">
              {formData.executionType === 'script'
                ? t('tasks.form.taskDescription')
                : t('tasks.form.prompt')}{' '}
              {formData.executionType === 'agent' && <span className="text-red-500">*</span>}
            </label>
            <div className="relative">
              <Textarea
                value={formData.prompt}
                onChange={(e) => {
                  setFormData({ ...formData, prompt: e.target.value });
                  if (errors.prompt) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.prompt;
                      return next;
                    });
                  }
                }}
                rows={4}
                className={cn('resize-none pb-11', errors.prompt && 'border-red-500')}
                placeholder={t('tasks.form.promptPlaceholder')}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-end px-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOptimizePromptWithAi}
                  disabled={optimizingPrompt || submitting}
                  className="pointer-events-auto h-8 rounded-lg bg-card/95 px-2.5 text-xs sm:text-sm"
                >
                  {optimizingPrompt ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {optimizingPrompt ? t('tasks.form.aiOptimizing') : t('tasks.form.aiOptimize')}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('tasks.form.aiOptimizeHint')}</p>
            {errors.prompt && <p className="text-sm text-red-600">{errors.prompt}</p>}
          </div>

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

          <div className="space-y-2 rounded-xl border border-border/70 bg-muted/10 p-3">
            <button
              type="button"
              onClick={() => setIsAdvancedOpen((prev) => !prev)}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <div className="space-y-1">
                <div className="text-sm font-medium text-foreground/85">{t('tasks.form.advancedTitle')}</div>
                <p className="text-xs text-muted-foreground">{t('tasks.form.advancedHint')}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                {isAdvancedOpen
                  ? t('tasks.form.advancedToggleClose')
                  : t('tasks.form.advancedToggleOpen')}
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', !isAdvancedOpen && '-rotate-90')}
                />
              </span>
            </button>

            {isAdvancedOpen && (
              <div className="space-y-3 border-t border-border/60 pt-3">
                <div className="grid gap-3 md:grid-cols-2">
                  {isAdmin && (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-foreground/80">
                        {t('tasks.form.executionType')}
                      </label>
                      <Select
                        value={formData.executionType}
                        onValueChange={(value) => {
                          setFormData((prev) => ({
                            ...prev,
                            executionType: value as 'agent' | 'script',
                          }));
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
                    <label className="block text-xs font-medium text-foreground/80">
                      {t('tasks.form.contextMode')}
                    </label>
                    <Select
                      value={formData.contextMode}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          contextMode: value as ContextMode,
                        }))
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

                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-xs font-medium text-foreground/80">
                      {t('tasks.form.executionEnvironment')}
                    </label>
                    <Select
                      value={formData.executionEnvironment}
                      onValueChange={(value) =>
                        setFormData((prev) => ({
                          ...prev,
                          executionEnvironment: value as 'local' | 'worktree',
                        }))
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="worktree">{t('tasks.form.executionEnvironmentWorktree')}</SelectItem>
                        <SelectItem value="local">{t('tasks.form.executionEnvironmentLocal')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t('tasks.form.executionEnvironmentHint')}</p>
                  </div>

                  {formData.executionType !== 'script' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-foreground/80">
                        {t('tasks.form.operationPermissionMode')}
                      </label>
                      <Select
                        value={formData.operationPermissionMode}
                        onValueChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            operationPermissionMode: value as 'default' | 'bypass',
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">{t('tasks.form.permissionDefault')}</SelectItem>
                          <SelectItem value="bypass">{t('tasks.form.permissionBypass')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{t('tasks.form.permissionHint')}</p>
                    </div>
                  )}

                  {formData.executionType !== 'script' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-foreground/80">
                        {t('tasks.form.agentRuntimeOverride')}
                      </label>
                      <Select
                        value={formData.agentRuntimeOverride ?? '__system_default__'}
                        onValueChange={(value) =>
                          setFormData((prev) => ({
                            ...prev,
                            agentRuntimeOverride:
                              value === '__system_default__' ? null : (value as AgentRuntimeId),
                          }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__system_default__">
                            {t('tasks.form.runtimeSystemDefault')}
                          </SelectItem>
                          {runtimeOptions.map((runtime) => (
                            <SelectItem key={runtime.id} value={runtime.id}>
                              {runtime.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{t('tasks.form.runtimeHint')}</p>
                    </div>
                  )}
                </div>

                {formData.executionType === 'script' && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-foreground/80">
                      {t('tasks.form.scriptCommand')} <span className="text-red-500">*</span>
                    </label>
                    <Input
                      value={formData.scriptCommand}
                      onChange={(e) => {
                        setFormData((prev) => ({ ...prev, scriptCommand: e.target.value }));
                        setErrors((prev) => {
                          const next = { ...prev };
                          delete next.scriptCommand;
                          return next;
                        });
                      }}
                      className={cn(errors.scriptCommand && 'border-red-500')}
                      placeholder={t('tasks.form.scriptCommandPlaceholder')}
                    />
                    {errors.scriptCommand && (
                      <p className="text-sm text-red-600">{errors.scriptCommand}</p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="block text-xs font-medium text-foreground/80">
                    {t('tasks.form.skillRefs')}
                  </label>
                  <Input
                    value={skillRefsInput}
                    onChange={(e) => {
                      setSkillRefsInput(e.target.value);
                      setDependencyDetails(null);
                      setInstallSelections({});
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.skillRefs;
                        delete next.submit;
                        return next;
                      });
                    }}
                    className={cn(errors.skillRefs && 'border-red-500')}
                    placeholder={t('tasks.form.skillRefsPlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground">{t('tasks.form.skillRefsHint')}</p>
                  {errors.skillRefs && <p className="text-sm text-red-600">{errors.skillRefs}</p>}
                </div>
              </div>
            )}
          </div>

          {dependencyDetails && dependencyDetails.missingSkillRefs.length > 0 && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <div className="text-sm font-medium text-amber-800">{t('tasks.form.missingSkillInstallTitle')}</div>
              {dependencyDetails.missingSkillRefs.map((skillRef) => {
                const candidates = dependencyDetails.skillInstallCandidates[skillRef] ?? [];
                const options = dependencyDetails.skillInstallOptions[skillRef] ?? candidates.map((candidate) => candidate.package);
                const hasCandidates = options.length > 0;
                return (
                  <div key={skillRef} className="space-y-1">
                    <div className="text-xs text-amber-900/90">
                      <code className="rounded bg-amber-100 px-1 py-0.5">{skillRef}</code>
                    </div>
                    {hasCandidates ? (
                      <Select
                        value={installSelections[skillRef] || undefined}
                        onValueChange={(value) => {
                          setInstallSelections((prev) => ({ ...prev, [skillRef]: value }));
                        }}
                      >
                        <SelectTrigger className="bg-white">
                          <SelectValue placeholder={t('tasks.form.installPackage')} />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((pkg) => (
                            <SelectItem key={`${skillRef}:${pkg}`} value={pkg}>
                              {pkg}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="text-xs text-amber-700">{t('tasks.form.errors.dependencyNoInstallCandidates')}</div>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  disabled={installingMissingSkills || submitting}
                  onClick={handleInstallMissingSkillsAndRetry}
                >
                  {(installingMissingSkills || submitting) && <Loader2 className="size-4 animate-spin" />}
                  {installingMissingSkills
                    ? t('tasks.form.installingSkills')
                    : t('tasks.form.installMissingSkills')}
                </Button>
              </div>
            </div>
          )}

          {errors.submit && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errors.submit}
            </div>
          )}

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
