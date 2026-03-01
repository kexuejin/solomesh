import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Loader2, Plus, RefreshCw, Sparkles, Upload } from 'lucide-react';

import { api } from '../../api/client';
import {
  isWorkflowTemplateEditorError,
  parseWorkflowTemplateEditorInput,
  serializeWorkflowTemplateForEditor,
  type WorkflowTemplateEditorMode,
} from '../../lib/workflow-template-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  SettingsNotification,
  WorkflowTemplate,
  WorkflowTemplateRecordPublic,
  WorkflowTemplateScope,
} from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface WorkflowSectionProps extends SettingsNotification {
  canManageSystemConfig: boolean;
}

interface ListResponse {
  templates: WorkflowTemplateRecordPublic[];
}

interface TemplateAiResponse {
  provider: 'claude' | 'codex' | 'gemini';
  templateId: string;
  template: WorkflowTemplate;
  markdown: string;
}

type AiGenerateProvider = 'auto' | 'claude' | 'codex' | 'gemini';
type LifecycleFilter = 'all' | WorkflowTemplateRecordPublic['lifecycle'];
type SaveDraftStrategy = 'auto' | 'overwrite' | 'new';
type WorkflowPanelMode = 'detail' | 'edit';

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const AI_TEMPLATE_GENERATE_TIMEOUT_MS = 600_000;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeSkillRef(value: string): string {
  return value.trim().toLowerCase();
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeSkillRef(rawKey);
    if (!key || typeof rawValue !== 'string') continue;
    const normalizedValue = rawValue.trim();
    if (!normalizedValue) continue;
    result[key] = normalizedValue;
  }
  return result;
}

function toStringArrayMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, string[]> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeSkillRef(rawKey);
    if (!key) continue;
    const dedup = Array.from(new Set(toStringArray(rawValue).map((item) => item.trim()).filter((item) => item.length > 0)));
    result[key] = dedup;
  }
  return result;
}

interface PublishDependencyDetails {
  missingSkillRefs: string[];
  invalidSkillRefs: string[];
  availableSkillRefs: string[];
  skillInstallOptions: Record<string, string[]>;
  skillInstallCandidates: Record<string, Array<{
    package: string;
    installs?: string;
    description?: string;
  }>>;
  unresolvedSkillRefs: string[];
  invalidPackageSkillRefs: string[];
  selectedPackagesBySkillRef: Record<string, string>;
}

interface PublishTemplateResponse {
  template: WorkflowTemplateRecordPublic;
  autoInstallResult?: {
    selectedPackagesBySkillRef: Record<string, string>;
    installedSkills: Array<{ skillRef: string; pkg: string }>;
    failedSkills: Array<{ skillRef: string; pkg: string; reason: string }>;
  };
}

interface WorkflowTemplatePrecheckResponse {
  templateId: string;
  hasBlockingIssues: boolean;
  dependencyCheck: {
    invalidSkillRefs: string[];
    missingSkillRefs: string[];
    availableSkillRefs: string[];
    skillInstallOptions: Record<string, string[]>;
    skillInstallCandidates: Record<string, Array<{
      package: string;
      installs?: string;
      description?: string;
    }>>;
  };
}

interface WorkflowDependencyPrecheckState {
  status: 'idle' | 'checking' | 'ok' | 'blocked' | 'invalid' | 'error';
  templateId: string | null;
  details: PublishDependencyDetails | null;
  message: string | null;
}

function parseInstallCount(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.trim().toUpperCase();
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMB])?$/.exec(normalized);
  if (!match) return 0;
  const base = Number.parseFloat(match[1] || '0');
  if (!Number.isFinite(base)) return 0;
  const unit = match[2] || '';
  if (unit === 'K') return Math.round(base * 1_000);
  if (unit === 'M') return Math.round(base * 1_000_000);
  if (unit === 'B') return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

function toSkillInstallCandidatesMap(value: unknown): PublishDependencyDetails['skillInstallCandidates'] {
  if (!value || typeof value !== 'object') return {};
  const result: PublishDependencyDetails['skillInstallCandidates'] = {};
  for (const [rawSkillRef, rawCandidates] of Object.entries(value as Record<string, unknown>)) {
    const skillRef = normalizeSkillRef(rawSkillRef);
    if (!skillRef || !Array.isArray(rawCandidates)) continue;
    const dedup = new Set<string>();
    const candidates = rawCandidates
      .map((raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const item = raw as Record<string, unknown>;
        const pkg = typeof item.package === 'string' ? item.package.trim() : '';
        if (!pkg || dedup.has(pkg)) return null;
        dedup.add(pkg);
        const installs = typeof item.installs === 'string' ? item.installs.trim() : '';
        const description = typeof item.description === 'string' ? item.description.trim() : '';
        return {
          package: pkg,
          ...(installs ? { installs } : {}),
          ...(description ? { description } : {}),
        };
      })
      .filter((item): item is { package: string; installs?: string; description?: string } => item !== null)
      .sort((a, b) => {
        const installDiff = parseInstallCount(b.installs) - parseInstallCount(a.installs);
        if (installDiff !== 0) return installDiff;
        return a.package.localeCompare(b.package);
      });
    result[skillRef] = candidates;
  }
  return result;
}

function parsePublishDependencyDetails(err: unknown): PublishDependencyDetails | null {
  if (!err || typeof err !== 'object' || !('details' in err)) return null;
  const details = (err as { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;

  const payload = details as Record<string, unknown>;
  const missingSkillRefs = toStringArray(payload.missingSkillRefs).map(normalizeSkillRef).filter(Boolean);
  const invalidSkillRefs = toStringArray(payload.invalidSkillRefs).map(normalizeSkillRef).filter(Boolean);
  const availableSkillRefs = toStringArray(payload.availableSkillRefs).map(normalizeSkillRef).filter(Boolean);
  if (missingSkillRefs.length === 0 && invalidSkillRefs.length === 0) return null;

  const skillInstallOptions = toStringArrayMap(payload.skillInstallOptions);
  const skillInstallCandidates = toSkillInstallCandidatesMap(payload.skillInstallCandidates);
  for (const [rawSkillRef, options] of Object.entries(skillInstallOptions)) {
    const skillRef = normalizeSkillRef(rawSkillRef);
    if (!skillRef) continue;
    if (!skillInstallCandidates[skillRef] || skillInstallCandidates[skillRef].length === 0) {
      skillInstallCandidates[skillRef] = options
        .map((pkg) => ({ package: pkg }))
        .sort((a, b) => a.package.localeCompare(b.package));
    }
    skillInstallOptions[skillRef] = skillInstallCandidates[skillRef].map((candidate) => candidate.package);
  }

  return {
    missingSkillRefs,
    invalidSkillRefs,
    availableSkillRefs,
    skillInstallOptions,
    skillInstallCandidates,
    unresolvedSkillRefs: toStringArray(payload.unresolvedSkillRefs).map(normalizeSkillRef).filter(Boolean),
    invalidPackageSkillRefs: toStringArray(payload.invalidPackageSkillRefs).map(normalizeSkillRef).filter(Boolean),
    selectedPackagesBySkillRef: toStringRecord(payload.selectedPackagesBySkillRef),
  };
}

function buildPublishDependencyDetailsFromPrecheck(
  dependencyCheck: WorkflowTemplatePrecheckResponse['dependencyCheck'],
): PublishDependencyDetails {
  const skillInstallOptions = toStringArrayMap(dependencyCheck.skillInstallOptions);
  const skillInstallCandidates = toSkillInstallCandidatesMap(dependencyCheck.skillInstallCandidates);
  for (const [rawSkillRef, options] of Object.entries(skillInstallOptions)) {
    const skillRef = normalizeSkillRef(rawSkillRef);
    if (!skillRef) continue;
    if (!skillInstallCandidates[skillRef] || skillInstallCandidates[skillRef].length === 0) {
      skillInstallCandidates[skillRef] = options.map((pkg) => ({ package: pkg }));
    }
    skillInstallOptions[skillRef] = skillInstallCandidates[skillRef].map((candidate) => candidate.package);
  }
  return {
    missingSkillRefs: dependencyCheck.missingSkillRefs.map(normalizeSkillRef).filter(Boolean),
    invalidSkillRefs: dependencyCheck.invalidSkillRefs.map(normalizeSkillRef).filter(Boolean),
    availableSkillRefs: dependencyCheck.availableSkillRefs.map(normalizeSkillRef).filter(Boolean),
    skillInstallOptions,
    skillInstallCandidates,
    unresolvedSkillRefs: [],
    invalidPackageSkillRefs: [],
    selectedPackagesBySkillRef: {},
  };
}

function formatPublishDependencyError(
  err: unknown,
  t: ReturnType<typeof useI18n>['t'],
): string | null {
  const parsed = parsePublishDependencyDetails(err);
  if (!parsed) return null;
  const listSeparator = t('settings.workflows.format.listSeparator');
  const segmentSeparator = t('settings.workflows.format.segmentSeparator');

  const segments: string[] = [];
  if (parsed.missingSkillRefs.length > 0) {
    segments.push(t('settings.workflows.publishError.missingSkills', { refs: parsed.missingSkillRefs.join(listSeparator) }));
  }
  if (parsed.invalidSkillRefs.length > 0) {
    segments.push(t('settings.workflows.publishError.invalidSkills', { refs: parsed.invalidSkillRefs.join(listSeparator) }));
  }
  if (parsed.unresolvedSkillRefs.length > 0) {
    segments.push(t('settings.workflows.publishError.unresolvedPackages', { refs: parsed.unresolvedSkillRefs.join(listSeparator) }));
  }
  if (parsed.invalidPackageSkillRefs.length > 0) {
    segments.push(t('settings.workflows.publishError.invalidPackages', { refs: parsed.invalidPackageSkillRefs.join(listSeparator) }));
  }
  if (parsed.availableSkillRefs.length > 0) {
    const preview = parsed.availableSkillRefs.slice(0, 12);
    segments.push(
      t('settings.workflows.publishError.availableSkills', {
        refs: preview.join(listSeparator),
        suffix: parsed.availableSkillRefs.length > preview.length ? t('settings.workflows.publishError.availableSuffix') : '',
      }),
    );
  }
  return t('settings.workflows.publishError.prefix', { message: segments.join(segmentSeparator) });
}

function getWorkflowEditorErrorMessage(
  err: unknown,
  t: ReturnType<typeof useI18n>['t'],
  fallback: string,
): string {
  if (isWorkflowTemplateEditorError(err)) {
    if (err.code === 'invalid_stage_id') {
      return t('settings.workflows.errors.invalidStageId', {
        stageId: err.details?.stageId || '-',
      });
    }
    if (err.code === 'stage_required') {
      return t('settings.workflows.errors.stageRequired');
    }
    if (err.code === 'invalid_template_id_markdown') {
      return t('settings.workflows.errors.invalidTemplateIdMarkdown');
    }
    if (err.code === 'json_invalid') {
      return t('settings.workflows.errors.templateJsonInvalid');
    }
    if (err.code === 'json_not_object') {
      return t('settings.workflows.errors.templateJsonNotObject');
    }
    if (err.code === 'template_id_required') {
      return t('settings.workflows.errors.templateIdRequired');
    }
  }
  return getErrorMessage(err, fallback);
}

function normalizeTemplateId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!TEMPLATE_ID_RE.test(normalized)) return null;
  return normalized;
}

const DEFAULT_STAGE_NAME = '\u9636\u6bb5 1';
const DEFAULT_DONE_KEYWORD = '\u5b8c\u6210';

function createDefaultTemplate(templateId: string): WorkflowTemplate {
  return {
    id: templateId,
    name: templateId,
    description: '',
    version: 1,
    stages: [
      {
        id: 'step-1',
        name: DEFAULT_STAGE_NAME,
        defaultProvider: 'claude',
        strictProvider: false,
        fallbackProviders: ['codex'],
        goal: '',
        requiredOutputHints: [],
        doneKeywords: [DEFAULT_DONE_KEYWORD],
        skillRefs: [],
      },
    ],
    recommendedTriggers: [],
  };
}

function canonicalizeTemplateForCompare(
  template: WorkflowTemplate,
  mode: WorkflowTemplateEditorMode,
): WorkflowTemplate {
  try {
    const serialized = serializeWorkflowTemplateForEditor(template, mode);
    return parseWorkflowTemplateEditorInput({
      mode,
      text: serialized,
      templateIdFallback: template.id,
    }).payload;
  } catch {
    return template;
  }
}

function getLifecycleBadgeClass(lifecycle: WorkflowTemplateRecordPublic['lifecycle']): string {
  if (lifecycle === 'published') return 'bg-emerald-100 text-emerald-700';
  if (lifecycle === 'draft') return 'bg-amber-100 text-amber-700';
  return 'bg-muted text-muted-foreground';
}

function getScopeLabel(
  scope: WorkflowTemplateScope,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return scope === 'global' ? t('settings.workflows.scope.global') : t('settings.workflows.scope.user');
}

function formatLocalTime(
  value: string | null | undefined,
  locale: ReturnType<typeof useI18n>['locale'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!value) return t('settings.workflows.notAvailable');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('settings.workflows.notAvailable');
  return date.toLocaleString(localeForDateTime(locale), { hour12: false });
}

function parseTimestamp(value: string): number {
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

interface WorkflowTemplateDetailMeta {
  stageProviders: string[];
  skillRefs: string[];
  dependencyRefs: string[];
  capabilityRefs: string[];
  inferredFiles: string[];
}

function collectWorkflowTemplateDetailMeta(template: WorkflowTemplate): WorkflowTemplateDetailMeta {
  const stageProviders = new Set<string>();
  const skillRefs = new Set<string>();
  const dependencyRefs = new Set<string>();
  const capabilityRefs = new Set<string>();

  for (const stage of template.stages) {
    stageProviders.add(stage.defaultProvider);
    for (const skill of stage.skillRefs ?? []) {
      const ref = skill.trim();
      if (!ref) continue;
      skillRefs.add(ref);
    }
    for (const dependency of stage.dependencies ?? []) {
      const ref = dependency.ref.trim();
      if (!ref) continue;
      dependencyRefs.add(`${dependency.type}:${ref}`);
      if (dependency.type === 'skill') {
        skillRefs.add(ref);
      }
      if (dependency.capability && dependency.capability.trim().length > 0) {
        capabilityRefs.add(dependency.capability.trim());
      }
    }
  }

  const inferredFiles = Array.from(skillRefs).map((skillRef) => `skills/${skillRef}/SKILL.md`);
  return {
    stageProviders: Array.from(stageProviders).sort((a, b) => a.localeCompare(b)),
    skillRefs: Array.from(skillRefs).sort((a, b) => a.localeCompare(b)),
    dependencyRefs: Array.from(dependencyRefs).sort((a, b) => a.localeCompare(b)),
    capabilityRefs: Array.from(capabilityRefs).sort((a, b) => a.localeCompare(b)),
    inferredFiles: inferredFiles.sort((a, b) => a.localeCompare(b)),
  };
}

export function WorkflowSection({ canManageSystemConfig, setNotice, setError }: WorkflowSectionProps) {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const listSeparator = t('settings.workflows.format.listSeparator');
  const segmentSeparator = t('settings.workflows.format.segmentSeparator');
  const [scope, setScope] = useState<WorkflowTemplateScope>('user');
  const [visibleTemplates, setVisibleTemplates] = useState<WorkflowTemplateRecordPublic[]>([]);
  const [manageTemplates, setManageTemplates] = useState<WorkflowTemplateRecordPublic[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detachedRecord, setDetachedRecord] = useState<WorkflowTemplateRecordPublic | null>(null);
  const [pendingSaveDecision, setPendingSaveDecision] = useState<{
    originalId: string;
    nextId: string;
  } | null>(null);
  const [templateQuery, setTemplateQuery] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('all');
  const [templateIdInput, setTemplateIdInput] = useState('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [editorMode, setEditorMode] = useState<WorkflowTemplateEditorMode>('markdown');
  const [editorText, setEditorText] = useState('');
  const [panelMode, setPanelMode] = useState<WorkflowPanelMode>('detail');

  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishingWithInstall, setPublishingWithInstall] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [aiIdea, setAiIdea] = useState('');
  const [aiProvider, setAiProvider] = useState<AiGenerateProvider>('auto');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiOptimizeInstruction, setAiOptimizeInstruction] = useState('');
  const [aiOptimizing, setAiOptimizing] = useState(false);
  const [pendingPublishInstall, setPendingPublishInstall] = useState<{
    templateId: string;
    details: PublishDependencyDetails;
  } | null>(null);
  const [publishInstallSelections, setPublishInstallSelections] = useState<Record<string, string>>({});
  const [publishInstallSearchBySkillRef, setPublishInstallSearchBySkillRef] = useState<Record<string, string>>({});
  const [dependencyPrecheck, setDependencyPrecheck] = useState<WorkflowDependencyPrecheckState>({
    status: 'idle',
    templateId: null,
    details: null,
    message: null,
  });
  const [dependencyPrecheckRefreshToken, setDependencyPrecheckRefreshToken] = useState(0);

  useEffect(() => {
    if (!canManageSystemConfig && scope !== 'user') {
      setScope('user');
    }
  }, [canManageSystemConfig, scope]);

  useEffect(() => {
    setTemplateQuery('');
    setLifecycleFilter('all');
    setDetachedRecord(null);
    setPendingPublishInstall(null);
    setPublishInstallSelections({});
    setPublishInstallSearchBySkillRef({});
    setDependencyPrecheck({
      status: 'idle',
      templateId: null,
      details: null,
      message: null,
    });
    setDependencyPrecheckRefreshToken(0);
    setPanelMode('detail');
  }, [scope]);

  const selectedRecord = useMemo(() => {
    if (!selectedKey) return null;
    return manageTemplates.find((item) => `${item.scope}:${item.template.id}:${item.lifecycle}` === selectedKey) ?? null;
  }, [selectedKey, manageTemplates]);
  const filteredManageTemplates = useMemo(() => {
    const q = templateQuery.trim().toLowerCase();
    return manageTemplates
      .filter((item) => {
        if (lifecycleFilter !== 'all' && item.lifecycle !== lifecycleFilter) return false;
        if (!q) return true;
        const haystack = [
          item.template.id,
          item.template.name,
          item.template.description,
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
  }, [lifecycleFilter, manageTemplates, templateQuery]);

  const lifecycleCounts = useMemo(() => ({
    all: manageTemplates.length,
    draft: manageTemplates.filter((item) => item.lifecycle === 'draft').length,
    published: manageTemplates.filter((item) => item.lifecycle === 'published').length,
    archived: manageTemplates.filter((item) => item.lifecycle === 'archived').length,
  }), [manageTemplates]);

  const detailTemplate = useMemo(() => {
    if (editorText.trim().length === 0) {
      return selectedRecord?.template ?? null;
    }
    try {
      return parseWorkflowTemplateEditorInput({
        mode: editorMode,
        text: editorText,
        templateIdFallback: templateIdInput,
      }).payload;
    } catch {
      return selectedRecord?.template ?? null;
    }
  }, [editorMode, editorText, selectedRecord, templateIdInput]);

  const detailMeta = useMemo(
    () => (detailTemplate ? collectWorkflowTemplateDetailMeta(detailTemplate) : null),
    [detailTemplate],
  );
  const activeRecord = selectedRecord ?? detachedRecord;
  const detailScopeLabel = activeRecord ? getScopeLabel(activeRecord.scope, t) : getScopeLabel(scope, t);
  const detailLifecycle = activeRecord?.lifecycle ?? 'draft';
  const detailCallable = detailLifecycle === 'published';
  const isGlobalReadonly = !!activeRecord && activeRecord.scope === 'global' && !canManageSystemConfig;

  const hasUnsavedChanges = useMemo(() => {
    const baselineRecord = selectedRecord ?? detachedRecord;
    if (!baselineRecord) return editorText.trim().length > 0;
    if (!editorText.trim()) return false;
    try {
      const parsed = parseWorkflowTemplateEditorInput({
        mode: editorMode,
        text: editorText,
        templateIdFallback: templateIdInput,
      });
      const baselineTemplate = canonicalizeTemplateForCompare(baselineRecord.template, editorMode);
      const currentTemplate = canonicalizeTemplateForCompare(parsed.payload, editorMode);
      return (
        parsed.templateId !== baselineRecord.template.id
        || JSON.stringify(currentTemplate) !== JSON.stringify(baselineTemplate)
      );
    } catch {
      return true;
    }
  }, [detachedRecord, editorMode, editorText, selectedRecord, templateIdInput]);

  const confirmDiscardUnsavedChanges = useCallback((actionLabel: string): boolean => {
    if (!hasUnsavedChanges) return true;
    return window.confirm(t('settings.workflows.confirmDiscard', { action: actionLabel }));
  }, [hasUnsavedChanges, t]);

  const isEditingSelectedTemplate =
    !!selectedRecord && normalizeTemplateId(templateIdInput) === selectedRecord.template.id;
  const publishDisabled =
    publishing || publishingWithInstall || (isEditingSelectedTemplate ? !selectedRecord?.publishable : false);
  const archiveDisabled =
    archiving || (isEditingSelectedTemplate ? !selectedRecord?.archivable : false);
  const canAutoInstallForScope = scope === 'user';
  const dependencyPrecheckPanelClass =
    dependencyPrecheck.status === 'ok'
      ? 'border-emerald-200 bg-emerald-50/80'
      : dependencyPrecheck.status === 'blocked'
        ? 'border-amber-200 bg-amber-50/80'
        : dependencyPrecheck.status === 'error' || dependencyPrecheck.status === 'invalid'
          ? 'border-rose-200 bg-rose-50/80'
          : 'border-border bg-muted/70';
  const dependencyPrecheckStatusBadgeClass =
    dependencyPrecheck.status === 'ok'
      ? 'bg-emerald-100 text-emerald-700'
      : dependencyPrecheck.status === 'blocked'
        ? 'bg-amber-100 text-amber-700'
        : dependencyPrecheck.status === 'error' || dependencyPrecheck.status === 'invalid'
          ? 'bg-rose-100 text-rose-700'
          : 'bg-muted text-muted-foreground';
  const dependencyPrecheckStatusLabel =
    dependencyPrecheck.status === 'ok'
      ? t('settings.workflows.precheck.status.ok')
      : dependencyPrecheck.status === 'blocked'
        ? t('settings.workflows.precheck.status.blocked')
        : dependencyPrecheck.status === 'error'
          ? t('settings.workflows.precheck.status.error')
          : dependencyPrecheck.status === 'invalid'
            ? t('settings.workflows.precheck.status.invalid')
            : dependencyPrecheck.status === 'checking'
              ? t('settings.workflows.precheck.status.checking')
              : t('settings.workflows.precheck.status.idle');

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [visibleResp, manageResp] = await Promise.all([
        api.get<ListResponse>('/api/workflows/templates?view=visible'),
        api.get<ListResponse>(`/api/workflows/templates?view=manage&scope=${scope}&lifecycle=all`),
      ]);
      setVisibleTemplates(visibleResp.templates || []);
      setManageTemplates(manageResp.templates || []);

      if (selectedKey) {
        const matched = (manageResp.templates || []).find(
          (item) => `${item.scope}:${item.template.id}:${item.lifecycle}` === selectedKey,
        );
        if (!matched) {
          setSelectedKey(null);
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.workflows.errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [scope, selectedKey, setError, t]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    if (loading) return;
    if (panelMode !== 'edit') {
      setDependencyPrecheck({
        status: 'idle',
        templateId: null,
        details: null,
        message: null,
      });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      let targetTemplate: WorkflowTemplate | null = null;
      let targetTemplateId = '';

      if (editorText.trim().length === 0) {
        const sourceTemplate = selectedRecord?.template ?? detachedRecord?.template ?? null;
        if (!sourceTemplate) {
          if (!cancelled) {
            setDependencyPrecheck({
              status: 'idle',
              templateId: null,
              details: null,
              message: null,
            });
          }
          return;
        }
        targetTemplate = sourceTemplate;
        targetTemplateId = sourceTemplate.id;
      } else {
        try {
          const parsed = parseWorkflowTemplateEditorInput({
            mode: editorMode,
            text: editorText,
            templateIdFallback: templateIdInput,
          });
          targetTemplate = parsed.payload;
          targetTemplateId = parsed.templateId;
        } catch (err) {
          if (!cancelled) {
            setDependencyPrecheck({
              status: 'invalid',
              templateId: null,
              details: null,
              message: getWorkflowEditorErrorMessage(
                err,
                t,
                t('settings.workflows.errors.precheckTemplateInvalid'),
              ),
            });
          }
          return;
        }
      }

      setDependencyPrecheck((prev) => ({
        status: 'checking',
        templateId: targetTemplateId,
        details: prev.details,
        message: null,
      }));
      try {
        const resp = await api.post<WorkflowTemplatePrecheckResponse>(
          `/api/workflows/templates/${scope}/${encodeURIComponent(targetTemplateId)}/precheck`,
          { template: targetTemplate },
        );
        if (cancelled) return;
        const details = buildPublishDependencyDetailsFromPrecheck(resp.dependencyCheck);
        const blocked = details.invalidSkillRefs.length > 0 || details.missingSkillRefs.length > 0;
        const segments: string[] = [];
        if (details.missingSkillRefs.length > 0) {
          segments.push(t('settings.workflows.precheck.summary.missingSkills', { count: details.missingSkillRefs.length }));
        }
        if (details.invalidSkillRefs.length > 0) {
          segments.push(t('settings.workflows.precheck.summary.invalidSkills', { count: details.invalidSkillRefs.length }));
        }
        setDependencyPrecheck({
          status: blocked ? 'blocked' : 'ok',
          templateId: resp.templateId,
          details,
          message: blocked
            ? t('settings.workflows.precheck.summary.blocked', { segments: segments.join(segmentSeparator) })
            : t('settings.workflows.precheck.summary.pass'),
        });
      } catch (err) {
        if (cancelled) return;
        setDependencyPrecheck({
          status: 'error',
          templateId: targetTemplateId || null,
          details: null,
          message: getErrorMessage(err, t('settings.workflows.errors.precheckFailed')),
        });
      }
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    detachedRecord?.template,
    dependencyPrecheckRefreshToken,
    editorMode,
    editorText,
    loading,
    panelMode,
    scope,
    selectedRecord?.template,
    templateIdInput,
    t,
  ]);

  const handleRefreshDependencyPrecheck = () => {
    setDependencyPrecheckRefreshToken((value) => value + 1);
  };

  const handleRefreshTemplates = async () => {
    if (!confirmDiscardUnsavedChanges(t('settings.workflows.actions.refreshTemplates'))) return;
    await loadTemplates();
  };

  const handleScopeChange = (nextScope: WorkflowTemplateScope) => {
    if (nextScope === scope) return;
    if (!confirmDiscardUnsavedChanges(t('settings.workflows.actions.switchScope'))) return;
    setScope(nextScope);
  };

  const handleSelectRecord = (record: WorkflowTemplateRecordPublic) => {
    const nextKey = `${record.scope}:${record.template.id}:${record.lifecycle}`;
    if (nextKey !== selectedKey && !confirmDiscardUnsavedChanges(t('settings.workflows.actions.switchTemplate'))) return;
    setSelectedKey(`${record.scope}:${record.template.id}:${record.lifecycle}`);
    setDetachedRecord(null);
    setPendingSaveDecision(null);
    setTemplateIdInput(record.template.id);
    setEditorText(serializeWorkflowTemplateForEditor(record.template, editorMode));
    setPanelMode('detail');
    setNotice(null);
    setError(null);
  };

  const handleSelectVisibleTemplate = (record: WorkflowTemplateRecordPublic) => {
    if (!confirmDiscardUnsavedChanges(t('settings.workflows.actions.switchTemplate'))) return;
    const matched = manageTemplates.find(
      (item) =>
        item.scope === record.scope
        && item.template.id === record.template.id
        && item.lifecycle === record.lifecycle,
    );
    if (matched) {
      handleSelectRecord(matched);
      return;
    }
    setSelectedKey(null);
    setDetachedRecord(record);
    setPendingSaveDecision(null);
    setTemplateIdInput(record.template.id);
    setEditorText(serializeWorkflowTemplateForEditor(record.template, editorMode));
    setPanelMode('detail');
    setNotice(t('settings.workflows.notice.loadedVisibleTemplate', { id: record.template.id }));
    setError(null);
  };

  const handleCreateDraft = () => {
    if (!confirmDiscardUnsavedChanges(t('settings.workflows.actions.createTemplate'))) return;
    setNotice(null);
    setError(null);
    const templateId = normalizeTemplateId(newTemplateId);
    if (!templateId) {
      setError(t('settings.workflows.errors.invalidTemplateId'));
      return;
    }

    const template = createDefaultTemplate(templateId);
    setTemplateIdInput(templateId);
    setEditorText(serializeWorkflowTemplateForEditor(template, editorMode));
    setSelectedKey(null);
    setDetachedRecord(null);
    setPendingSaveDecision(null);
    setPanelMode('edit');
    setNotice(t('settings.workflows.notice.draftScaffoldCreated', { id: templateId }));
  };

  const handleGenerateDraftWithAi = async () => {
    const idea = aiIdea.trim();
    if (idea.length < 8) {
      setError(t('settings.workflows.errors.aiIdeaTooShort'));
      return;
    }

    const templateIdHint = normalizeTemplateId(newTemplateId);
    setAiGenerating(true);
    setNotice(null);
    setError(null);
    try {
      const resp = await api.post<TemplateAiResponse>(
        '/api/workflows/templates/generate',
        {
          idea,
          ...(templateIdHint ? { templateId: templateIdHint } : {}),
          ...(aiProvider !== 'auto' ? { provider: aiProvider } : {}),
        },
        AI_TEMPLATE_GENERATE_TIMEOUT_MS,
      );
      const markdown = resp.markdown?.trim().length > 0
        ? resp.markdown
        : serializeWorkflowTemplateForEditor(resp.template, 'markdown');
      setTemplateIdInput(resp.templateId);
      setNewTemplateId(resp.templateId);
      setSelectedKey(null);
      setDetachedRecord(null);
      setPendingSaveDecision(null);
      setEditorMode('markdown');
      setEditorText(markdown);
      setPanelMode('edit');
      setNotice(t('settings.workflows.notice.aiDraftGenerated', { id: resp.templateId, provider: resp.provider }));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.workflows.errors.aiGenerateFailed')));
    } finally {
      setAiGenerating(false);
    }
  };

  const handleOptimizeTemplateWithAi = async () => {
    const instruction = aiOptimizeInstruction.trim();
    if (instruction.length < 4) {
      setError(t('settings.workflows.errors.aiOptimizeInstructionTooShort'));
      return;
    }

    const parsed = parseEditorTemplate();
    if (!parsed) return;

    setAiOptimizing(true);
    setNotice(null);
    setError(null);
    try {
      const resp = await api.post<TemplateAiResponse>(
        `/api/workflows/templates/${scope}/${encodeURIComponent(parsed.templateId)}/optimize`,
        {
          instruction,
          template: parsed.payload,
          ...(aiProvider !== 'auto' ? { provider: aiProvider } : {}),
        },
        AI_TEMPLATE_GENERATE_TIMEOUT_MS,
      );
      const nextText = editorMode === 'markdown'
        ? (resp.markdown?.trim().length > 0
          ? resp.markdown
          : serializeWorkflowTemplateForEditor(resp.template, 'markdown'))
        : serializeWorkflowTemplateForEditor(resp.template, 'json');
      setTemplateIdInput(resp.templateId);
      setEditorText(nextText);
      setSelectedKey(null);
      setDetachedRecord(null);
      setPendingSaveDecision(null);
      setPanelMode('edit');
      setNotice(t('settings.workflows.notice.aiTemplateOptimized', { id: resp.templateId, provider: resp.provider }));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.workflows.errors.aiOptimizeFailed')));
    } finally {
      setAiOptimizing(false);
    }
  };

  const parseEditorTemplate = (): { templateId: string; payload: WorkflowTemplate } | null => {
    try {
      return parseWorkflowTemplateEditorInput({
        mode: editorMode,
        text: editorText,
        templateIdFallback: templateIdInput,
      });
    } catch (err) {
      setError(getWorkflowEditorErrorMessage(err, t, t('settings.workflows.errors.templateFormatInvalid')));
      return null;
    }
  };

  const handleSwitchEditorMode = (nextMode: WorkflowTemplateEditorMode) => {
    if (nextMode === editorMode) return;
    setNotice(null);
    setError(null);

    if (!editorText.trim()) {
      setEditorMode(nextMode);
      return;
    }

    try {
      const parsed = parseWorkflowTemplateEditorInput({
        mode: editorMode,
        text: editorText,
        templateIdFallback: templateIdInput,
      });
      setTemplateIdInput(parsed.templateId);
      setEditorText(serializeWorkflowTemplateForEditor(parsed.payload, nextMode));
      setEditorMode(nextMode);
    } catch (err) {
      setError(getWorkflowEditorErrorMessage(err, t, t('settings.workflows.errors.switchEditorModeFailed')));
    }
  };

  const handleResetEditorToSelected = () => {
    if (!selectedRecord) {
      setError(t('settings.workflows.errors.noSelectedTemplateToRollback'));
      return;
    }
    setTemplateIdInput(selectedRecord.template.id);
    setEditorText(serializeWorkflowTemplateForEditor(selectedRecord.template, editorMode));
    setPendingSaveDecision(null);
    setNotice(t('settings.workflows.notice.rolledBackToSelected', { id: selectedRecord.template.id }));
    setError(null);
  };

  const handleSaveDraft = async (strategy: SaveDraftStrategy = 'auto') => {
    setNotice(null);
    setError(null);

    const parsed = parseEditorTemplate();
    if (!parsed) return;

    const originalId = selectedRecord?.template.id ?? null;
    if (strategy === 'auto' && originalId && parsed.templateId !== originalId) {
      setPendingSaveDecision({
        originalId,
        nextId: parsed.templateId,
      });
      return;
    }

    let targetTemplateId = parsed.templateId;
    let payload = parsed.payload;
    if (strategy === 'overwrite' && originalId) {
      targetTemplateId = originalId;
      payload = {
        ...parsed.payload,
        id: originalId,
      };
    }
    setPendingSaveDecision(null);
    setSavingDraft(true);

    try {
      const resp = await api.put<{ template: WorkflowTemplateRecordPublic }>(
        `/api/workflows/templates/${scope}/${targetTemplateId}`,
        payload,
      );
      const saved = resp.template;
      setTemplateIdInput(saved.template.id);
      setEditorText(serializeWorkflowTemplateForEditor(saved.template, editorMode));
      setSelectedKey(`${saved.scope}:${saved.template.id}:${saved.lifecycle}`);
      setDetachedRecord(null);
      setNotice(t('settings.workflows.notice.draftSaved', { id: saved.template.id }));
      await loadTemplates();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.workflows.errors.saveDraftFailed')));
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePublish = async () => {
    const templateId = normalizeTemplateId(templateIdInput);
    if (!templateId) {
      setError(t('settings.workflows.errors.selectOrInputTemplateId'));
      return;
    }

    setPublishing(true);
    setNotice(null);
    setError(null);
    setPendingPublishInstall(null);
    setPublishInstallSelections({});
    setPublishInstallSearchBySkillRef({});
    try {
      const resp = await api.post<PublishTemplateResponse>(
        `/api/workflows/templates/${scope}/${templateId}/publish`,
      );
      const saved = resp.template;
      setSelectedKey(`${saved.scope}:${saved.template.id}:${saved.lifecycle}`);
      setDetachedRecord(null);
      setTemplateIdInput(saved.template.id);
      setEditorText(serializeWorkflowTemplateForEditor(saved.template, editorMode));
      setNotice(t('settings.workflows.notice.published', { id: saved.template.id }));
      await loadTemplates();
    } catch (err) {
      const dependencyDetails = parsePublishDependencyDetails(err);
      if (dependencyDetails && dependencyDetails.missingSkillRefs.length > 0) {
        const nextSelections: Record<string, string> = { ...dependencyDetails.selectedPackagesBySkillRef };
        for (const skillRef of dependencyDetails.missingSkillRefs) {
          const key = normalizeSkillRef(skillRef);
          const options = dependencyDetails.skillInstallOptions[key] ?? [];
          if (!nextSelections[key] && options.length === 1) {
            nextSelections[key] = options[0]!;
          }
        }
        setPublishInstallSelections(nextSelections);
        setPendingPublishInstall({
          templateId,
          details: dependencyDetails,
        });
        setError(formatPublishDependencyError(err, t));
      } else {
        setError(formatPublishDependencyError(err, t) ?? getErrorMessage(err, t('settings.workflows.errors.publishFailed')));
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleInstallAndPublish = async () => {
    if (!pendingPublishInstall) return;

    const unresolvedSelectionRefs: string[] = [];
    const noOptionRefs: string[] = [];
    const packagesBySkillRef: Record<string, string> = {};

    for (const rawSkillRef of pendingPublishInstall.details.missingSkillRefs) {
      const skillRef = normalizeSkillRef(rawSkillRef);
      const options = pendingPublishInstall.details.skillInstallOptions[skillRef] ?? [];
      if (options.length === 0) {
        noOptionRefs.push(skillRef);
        continue;
      }
      const selected = (publishInstallSelections[skillRef] ?? '').trim();
      if (!selected) {
        unresolvedSelectionRefs.push(skillRef);
        continue;
      }
      packagesBySkillRef[skillRef] = selected;
    }

    if (noOptionRefs.length > 0) {
      setError(t('settings.workflows.errors.missingInstallCandidates', { refs: noOptionRefs.join(listSeparator) }));
      return;
    }
    if (unresolvedSelectionRefs.length > 0) {
      setError(t('settings.workflows.errors.selectInstallPackage', { refs: unresolvedSelectionRefs.join(listSeparator) }));
      return;
    }

    setPublishingWithInstall(true);
    setNotice(null);
    setError(null);
    try {
      const resp = await api.post<PublishTemplateResponse>(
        `/api/workflows/templates/${scope}/${pendingPublishInstall.templateId}/publish`,
        {
          autoInstallMissingSkills: true,
          provider: 'auto',
          packagesBySkillRef,
        },
      );
      const saved = resp.template;
      setSelectedKey(`${saved.scope}:${saved.template.id}:${saved.lifecycle}`);
      setDetachedRecord(null);
      setTemplateIdInput(saved.template.id);
      setEditorText(serializeWorkflowTemplateForEditor(saved.template, editorMode));
      setPendingPublishInstall(null);
      setPublishInstallSelections({});
      setPublishInstallSearchBySkillRef({});
      const installedCount = resp.autoInstallResult?.installedSkills?.length ?? Object.keys(packagesBySkillRef).length;
      if (installedCount > 0) {
        setNotice(t('settings.workflows.notice.publishedWithInstalledSkills', { id: saved.template.id, count: installedCount }));
      } else {
        setNotice(t('settings.workflows.notice.published', { id: saved.template.id }));
      }
      await loadTemplates();
    } catch (err) {
      const dependencyDetails = parsePublishDependencyDetails(err);
      if (dependencyDetails && dependencyDetails.missingSkillRefs.length > 0) {
        const nextSelections: Record<string, string> = {
          ...publishInstallSelections,
          ...dependencyDetails.selectedPackagesBySkillRef,
        };
        for (const skillRef of dependencyDetails.missingSkillRefs) {
          const key = normalizeSkillRef(skillRef);
          const options = dependencyDetails.skillInstallOptions[key] ?? [];
          if (!nextSelections[key] && options.length === 1) {
            nextSelections[key] = options[0]!;
          }
        }
        setPublishInstallSelections(nextSelections);
        setPendingPublishInstall({
          templateId: pendingPublishInstall.templateId,
          details: dependencyDetails,
        });
        setError(formatPublishDependencyError(err, t) ?? t('settings.workflows.errors.autoInstallStillMissing'));
      } else {
        setError(getErrorMessage(err, t('settings.workflows.errors.autoInstallAndPublishFailed')));
      }
    } finally {
      setPublishingWithInstall(false);
    }
  };

  const handleArchive = async () => {
    const templateId = normalizeTemplateId(templateIdInput);
    if (!templateId) {
      setError(t('settings.workflows.errors.selectOrInputTemplateId'));
      return;
    }

    setArchiving(true);
    setNotice(null);
    setError(null);
    try {
      const resp = await api.post<{ template: WorkflowTemplateRecordPublic }>(
        `/api/workflows/templates/${scope}/${templateId}/archive`,
      );
      const saved = resp.template;
      setSelectedKey(`${saved.scope}:${saved.template.id}:${saved.lifecycle}`);
      setDetachedRecord(null);
      setTemplateIdInput(saved.template.id);
      setEditorText(serializeWorkflowTemplateForEditor(saved.template, editorMode));
      setNotice(t('settings.workflows.notice.archived', { id: saved.template.id }));
      await loadTemplates();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.workflows.errors.archiveFailed')));
    } finally {
      setArchiving(false);
    }
  };

  const handleQuickMetaEdit = (patch: Pick<WorkflowTemplate, 'name' | 'description'>) => {
    setNotice(null);
    setError(null);
    const parsed = parseEditorTemplate();
    if (!parsed) return;
    const nextTemplate: WorkflowTemplate = {
      ...parsed.payload,
      name: patch.name,
      description: patch.description,
    };
    setEditorText(serializeWorkflowTemplateForEditor(nextTemplate, editorMode));
    setPendingSaveDecision(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">{t('settings.workflows.title')}</div>
            <div className="text-xs text-muted-foreground">
              {t('settings.workflows.headerSummary', {
                scope: getScopeLabel(scope, t),
                manageCount: manageTemplates.length,
                visibleCount: visibleTemplates.length,
              })}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-muted px-2 py-0.5 text-foreground">
                {t('settings.workflows.lifecycleHint')}
              </span>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                {t('settings.workflows.visibleTemplatesBadge', { count: visibleTemplates.length })}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => handleScopeChange('user')}
                className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                  scope === 'user'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('settings.workflows.scope.user')}
              </button>
              {canManageSystemConfig && (
                <button
                  type="button"
                  onClick={() => handleScopeChange('global')}
                  className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                    scope === 'global'
                      ? 'bg-card text-brand-700 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  >
                  {t('settings.workflows.scope.global')}
                </button>
              )}
            </div>
            <Button type="button" variant="outline" onClick={() => void handleRefreshTemplates()} className="h-10 rounded-xl">
              <RefreshCw className="size-4" />
              {t('settings.workflows.refresh')}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4 xl:grid-cols-2">
          <div className="rounded-lg space-y-3 bg-muted/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">{t('settings.workflows.createDraftTitle')}</div>
              <span className="rounded-full border border-border/70 bg-card/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                {t('settings.workflows.draftLabel')}
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newTemplateId}
                onChange={(e) => setNewTemplateId(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95 sm:flex-1"
                placeholder={t('settings.workflows.newTemplateIdPlaceholder')}
              />
              <Button type="button" variant="outline" onClick={handleCreateDraft} className="h-10 rounded-xl sm:shrink-0">
                <Plus className="size-4" />
                {t('settings.workflows.create')}
              </Button>
            </div>
          </div>

          <div className="surface-card-soft rounded-xl space-y-3 border border-brand-200 bg-brand-50/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">{t('settings.workflows.aiGenerateTitle')}</div>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-700">Claude/Codex/Gemini</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AiGenerateProvider)}
                className="h-10 rounded-xl border border-border/75 bg-card/95 px-3 text-sm text-foreground sm:w-52"
              >
                <option value="auto">{t('settings.workflows.autoSelectProvider')}</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
                <option value="gemini">Gemini</option>
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerateDraftWithAi}
                disabled={aiGenerating}
                className="h-10 rounded-xl sm:shrink-0"
              >
                {aiGenerating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {t('settings.workflows.aiGenerate')}
              </Button>
            </div>
            <Textarea
              value={aiIdea}
              onChange={(e) => setAiIdea(e.target.value)}
              className="min-h-[84px] rounded-xl border-border/75 bg-card/95 text-sm"
              placeholder={t('settings.workflows.aiIdeaPlaceholder')}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="space-y-3 lg:w-2/5">
          <div className="surface-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/35 px-4 py-3">
              <div className="text-sm font-medium text-foreground">
                {scope === 'global' ? t('settings.workflows.list.globalTitle') : t('settings.workflows.list.userTitle')}
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {t('settings.workflows.list.showingCount', {
                  filtered: filteredManageTemplates.length,
                  total: manageTemplates.length,
                })}
              </span>
            </div>
            <div className="space-y-3 px-4 py-3">
              <Input
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
                placeholder={t('settings.workflows.list.searchPlaceholder')}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  { key: 'all', label: t('settings.workflows.lifecycle.all'), count: lifecycleCounts.all },
                  { key: 'draft', label: t('settings.workflows.lifecycle.draft'), count: lifecycleCounts.draft },
                  { key: 'published', label: t('settings.workflows.lifecycle.published'), count: lifecycleCounts.published },
                  { key: 'archived', label: t('settings.workflows.lifecycle.archived'), count: lifecycleCounts.archived },
                ] as Array<{ key: LifecycleFilter; label: string; count: number }>).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setLifecycleFilter(item.key)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      lifecycleFilter === item.key
                        ? 'border-brand-700 bg-brand-700 text-white'
                        : 'border-border bg-muted/60 text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {item.label} {item.count}
                  </button>
                ))}
              </div>
              <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                {filteredManageTemplates.length === 0 && manageTemplates.length === 0 && (
                  <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                    {t('settings.workflows.list.emptyForScope')}
                  </div>
                )}
                {filteredManageTemplates.length === 0 && manageTemplates.length > 0 && (
                  <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                    {t('settings.workflows.list.noMatch')}
                  </div>
                )}
                {filteredManageTemplates.map((item) => {
                  const key = `${item.scope}:${item.template.id}:${item.lifecycle}`;
                  const active = key === selectedKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleSelectRecord(item)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-brand-300 bg-brand-50/70'
                          : 'border-border/70 bg-muted/15 hover:bg-muted/30'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{item.template.id}</div>
                        <div className="truncate text-xs text-muted-foreground">{item.template.name}</div>
                        {item.template.description.trim().length > 0 && (
                          <div className="truncate text-xs text-muted-foreground">{item.template.description}</div>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${getLifecycleBadgeClass(item.lifecycle)}`}>
                          {item.lifecycle}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                          {t('settings.workflows.stagesCount', { count: item.template.stages.length })}
                        </span>
                        {item.isBuiltin && (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700">
                            {t('settings.workflows.builtin')}
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {t('settings.workflows.updatedAt', { time: formatLocalTime(item.updatedAt, locale, t) })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="surface-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/35 px-4 py-3">
              <div className="text-sm font-medium text-foreground">{t('settings.workflows.visibleListTitle')}</div>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
                {visibleTemplates.length}
              </span>
            </div>
            <div className="min-h-32 max-h-[calc(100vh-24rem)] space-y-2 overflow-y-auto px-4 py-3 pr-3">
              {visibleTemplates.length === 0 && (
                <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
                  {t('settings.workflows.visibleListEmpty')}
                </div>
              )}
              {visibleTemplates.map((item) => (
                <button
                  key={`${item.scope}:${item.template.id}:${item.lifecycle}`}
                  type="button"
                  onClick={() => handleSelectVisibleTemplate(item)}
                  className="w-full rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/35"
                >
                  <div className="truncate text-xs font-medium text-foreground">{item.template.id}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{item.template.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {getScopeLabel(item.scope, t)}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${getLifecycleBadgeClass(item.lifecycle)}`}>
                      {item.lifecycle}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 lg:w-3/5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 p-3">
            <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
              <button
                type="button"
                onClick={() => setPanelMode('detail')}
                className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                  panelMode === 'detail'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('settings.workflows.view.detail')}
              </button>
              <button
                type="button"
                onClick={() => setPanelMode('edit')}
                className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                  panelMode === 'edit'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('settings.workflows.view.edit')}
                {hasUnsavedChanges && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                    {t('settings.workflows.unsaved')}
                  </span>
                )}
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {panelMode === 'detail' ? t('settings.workflows.mode.detail') : t('settings.workflows.mode.edit')}
            </span>
          </div>

          {panelMode === 'detail' && (detailTemplate && detailMeta ? (
            <div className="surface-card overflow-hidden">
              <div className="border-b border-border/70 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-xl font-bold text-foreground">{detailTemplate.name || detailTemplate.id}</h2>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">{detailTemplate.id}</div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {detailTemplate.description?.trim() ? detailTemplate.description : t('settings.workflows.noDescription')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {detailScopeLabel}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${getLifecycleBadgeClass(detailLifecycle)}`}>
                      {detailLifecycle}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        detailCallable ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {detailCallable ? t('settings.workflows.callable') : t('settings.workflows.draftState')}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                      {t('settings.workflows.stagesCount', { count: detailTemplate.stages.length })}
                    </span>
                    {isGlobalReadonly && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {t('settings.workflows.readonlyGlobal')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-b border-border/70 p-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/15 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{t('settings.workflows.invocableCommandLabel')}</span>
                    <code className="ml-2 text-xs text-foreground">/wf {detailTemplate.id}</code>
                  </div>
                  <div className="rounded-lg bg-muted/15 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{t('settings.workflows.providerLabel')}</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {detailMeta.stageProviders.length > 0 ? (
                        detailMeta.stageProviders.map((provider) => (
                          <span key={provider} className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground">
                            {provider}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground">{t('settings.workflows.undefined')}</span>
                      )}
                    </div>
                  </div>
                  {detailTemplate.recommendedTriggers.length > 0 && (
                    <div className="rounded-lg bg-muted/15 px-3 py-2 text-sm sm:col-span-2">
                      <span className="text-muted-foreground">{t('settings.workflows.recommendedTriggersLabel')}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {detailTemplate.recommendedTriggers.map((trigger) => (
                          <span key={trigger} className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-700">
                            {trigger}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {activeRecord && (
                    <div className="text-[12px] text-muted-foreground sm:col-span-2">
                      {t('settings.workflows.updatedAt', { time: formatLocalTime(activeRecord.updatedAt, locale, t) })}
                      {activeRecord.publishedAt
                        ? ` · ${t('settings.workflows.publishedAt', { time: formatLocalTime(activeRecord.publishedAt, locale, t) })}`
                        : ''}
                      {activeRecord.createdAt
                        ? ` · ${t('settings.workflows.createdAt', { time: formatLocalTime(activeRecord.createdAt, locale, t) })}`
                        : ''}
                    </div>
                  )}
                </div>
              </div>

              <div className="border-b border-border/70 p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{t('settings.workflows.stageDefinitionsTitle')}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t('settings.workflows.totalStages', { count: detailTemplate.stages.length })}
                  </span>
                </div>
                <div className="space-y-2">
                  {detailTemplate.stages.map((stage) => (
                    <div key={stage.id} className="rounded-lg bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{stage.name}</span>
                        <span className="rounded border border-border/70 bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">{stage.id}</span>
                        <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground">{stage.defaultProvider}</span>
                      </div>
                      {stage.goal?.trim() && (
                        <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{stage.goal}</div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(stage.skillRefs ?? []).map((skillRef) => (
                          <span key={`${stage.id}:skill:${skillRef}`} className="rounded bg-brand-50 px-2 py-0.5 text-[11px] text-primary">
                            {skillRef}
                          </span>
                        ))}
                        {(stage.dependencies ?? []).map((dependency) => (
                          <span
                            key={`${stage.id}:dep:${dependency.type}:${dependency.ref}`}
                            className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground"
                          >
                            {dependency.type}:{dependency.ref}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {(detailMeta.skillRefs.length > 0 || detailMeta.capabilityRefs.length > 0 || detailMeta.inferredFiles.length > 0) && (
                <div className="border-b border-border/70 p-5">
                  <h3 className="mb-3 text-sm font-semibold text-foreground">{t('settings.workflows.associationsTitle')}</h3>
                  <div className="space-y-2 text-sm">
                    {detailMeta.skillRefs.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">{t('settings.workflows.skillsLabel')}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {detailMeta.skillRefs.map((skillRef) => (
                            <span key={`meta-skill:${skillRef}`} className="rounded bg-brand-50 px-2 py-0.5 text-[11px] text-primary">
                              {skillRef}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {detailMeta.capabilityRefs.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">{t('settings.workflows.capabilitiesLabel')}</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {detailMeta.capabilityRefs.map((capabilityRef) => (
                            <span key={`meta-capability:${capabilityRef}`} className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                              {capabilityRef}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {detailMeta.inferredFiles.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">{t('settings.workflows.inferredFilesLabel')}</span>
                        <div className="mt-1 space-y-1">
                          {detailMeta.inferredFiles.map((filePath) => (
                            <div key={filePath} className="font-mono text-[11px] text-muted-foreground">
                              {filePath}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="surface-card-soft border-t border-border/70 p-4">
                <p className="text-sm text-muted-foreground">
                  {t('settings.workflows.detailReadonlyHint')}
                </p>
              </div>
            </div>
          ) : (
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/70 flex items-center justify-center px-4 py-10">
              <p className="text-xs text-muted-foreground">{t('settings.workflows.emptyDetailHint')}</p>
            </div>
          ))}

          {panelMode === 'edit' && (
            <div className="rounded-xl border border-border/70 bg-muted/10 space-y-4 p-4">
              <div className={`surface-card-soft rounded-xl border p-3 ${dependencyPrecheckPanelClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{t('settings.workflows.precheck.title')}</div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${dependencyPrecheckStatusBadgeClass}`}>
                      {dependencyPrecheckStatusLabel}
                    </span>
                    {dependencyPrecheck.templateId ? (
                      <span className="truncate font-mono text-xs text-muted-foreground">{dependencyPrecheck.templateId}</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRefreshDependencyPrecheck}
                    disabled={dependencyPrecheck.status === 'checking'}
                    className="h-10 rounded-xl"
                  >
                    {dependencyPrecheck.status === 'checking' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {t('settings.workflows.precheck.recheck')}
                  </Button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {dependencyPrecheck.status === 'idle' && t('settings.workflows.precheck.noTemplate')}
                  {dependencyPrecheck.status === 'checking' && t('settings.workflows.precheck.checking')}
                  {dependencyPrecheck.status !== 'idle' && dependencyPrecheck.status !== 'checking' && (dependencyPrecheck.message ?? '-')}
                </div>
                {dependencyPrecheck.details && (
                  <div className="mt-2 space-y-1 text-[11px]">
                    {dependencyPrecheck.details.missingSkillRefs.length > 0 && (
                      <div className="text-amber-800">
                        {t('settings.workflows.precheck.missingSkills', { refs: dependencyPrecheck.details.missingSkillRefs.join(listSeparator) })}
                      </div>
                    )}
                    {dependencyPrecheck.details.invalidSkillRefs.length > 0 && (
                      <div className="text-rose-700">
                        {t('settings.workflows.precheck.invalidSkills', { refs: dependencyPrecheck.details.invalidSkillRefs.join(listSeparator) })}
                      </div>
                    )}
                    {dependencyPrecheck.status === 'ok' && (
                      <div className="text-emerald-700">{t('settings.workflows.precheck.passHint')}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/10 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">{t('settings.workflows.templateNameLabel')}</div>
                  <Input
                    value={detailTemplate?.name ?? ''}
                    onChange={(e) => {
                      handleQuickMetaEdit({
                        name: e.target.value,
                        description: detailTemplate?.description ?? '',
                      });
                    }}
                    placeholder={t('settings.workflows.templateNamePlaceholder')}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
                <div className="rounded-lg bg-muted/10 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">{t('settings.workflows.templateDescriptionLabel')}</div>
                  <Textarea
                    value={detailTemplate?.description ?? ''}
                    onChange={(e) => {
                      handleQuickMetaEdit({
                        name: detailTemplate?.name ?? templateIdInput ?? 'workflow-template',
                        description: e.target.value,
                      });
                    }}
                    className="min-h-[72px] rounded-xl border-border/75 bg-card/95 text-sm"
                    placeholder={t('settings.workflows.templateDescriptionPlaceholder')}
                  />
                </div>
              </div>

              <div className="rounded-lg space-y-3 bg-muted/15 p-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <div className="mb-2 text-sm font-medium text-foreground">{t('settings.workflows.templateIdLabel')}</div>
                    <Input
                      value={templateIdInput}
                      onChange={(e) => setTemplateIdInput(e.target.value)}
                      placeholder={t('settings.workflows.newTemplateIdPlaceholder')}
                      className="h-10 rounded-xl border-border/75 bg-card/95"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {selectedRecord && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleResetEditorToSelected}
                        disabled={!hasUnsavedChanges}
                        className="h-10 rounded-xl"
                      >
                        {t('settings.workflows.rollbackToSelected')}
                      </Button>
                    )}
                    <Button type="button" onClick={() => void handleSaveDraft()} disabled={savingDraft} className="h-10 rounded-xl">
                      {savingDraft && <Loader2 className="size-4 animate-spin" />}
                      {t('settings.workflows.saveDraft')}
                    </Button>
                    <Button type="button" variant="outline" onClick={handlePublish} disabled={publishDisabled} className="h-10 rounded-xl">
                      {publishing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      {t('settings.workflows.publish')}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleArchive} disabled={archiveDisabled} className="h-10 rounded-xl">
                      {archiving && <Loader2 className="size-4 animate-spin" />}
                      {t('settings.workflows.archive')}
                    </Button>
                  </div>
                </div>
                {isEditingSelectedTemplate && selectedRecord && (!selectedRecord.publishable || !selectedRecord.archivable) && (
                  <div className="text-xs text-muted-foreground">
                    {t('settings.workflows.lifecycleLimitPrefix')}
                    {!selectedRecord.publishable ? t('settings.workflows.lifecycleLimitNotPublishable') : ''}
                    {!selectedRecord.archivable ? t('settings.workflows.lifecycleLimitNotArchivable') : ''}
                    {t('settings.workflows.lifecycleLimitHint')}
                  </div>
                )}
              </div>

              <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
                  <BookOpen className="size-4" />
                  {t('settings.workflows.aiOptimizeTitle')}
                </div>
                <Textarea
                  value={aiOptimizeInstruction}
                  onChange={(e) => setAiOptimizeInstruction(e.target.value)}
                  className="min-h-[88px] rounded-xl border-border/75 bg-card/95 text-sm"
                  placeholder={t('settings.workflows.aiOptimizePlaceholder')}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleOptimizeTemplateWithAi}
                    disabled={aiOptimizing}
                    className="h-10 rounded-xl"
                  >
                    {aiOptimizing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {t('settings.workflows.aiOptimizeAndFill')}
                  </Button>
                  <span className="text-xs text-amber-800">
                    {t('settings.workflows.aiOptimizeHint')}
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{t('settings.workflows.editorTitle')}</div>
                    {hasUnsavedChanges && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                        {t('settings.workflows.unsavedChanges')}
                      </span>
                    )}
                  </div>
                  <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
                    <button
                      type="button"
                      onClick={() => handleSwitchEditorMode('markdown')}
                      className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                        editorMode === 'markdown'
                          ? 'bg-card text-brand-700 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Markdown
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchEditorMode('json')}
                      className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                        editorMode === 'json'
                          ? 'bg-card text-brand-700 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      JSON
                    </button>
                  </div>
                </div>
                <Textarea
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  className="min-h-[420px] rounded-xl border-border/75 bg-muted/20 font-mono text-xs"
                  placeholder={
                    editorMode === 'markdown'
                      ? t('settings.workflows.editorPlaceholderMarkdown')
                      : t('settings.workflows.editorPlaceholderJson')
                  }
                />
                {selectedRecord && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('settings.workflows.currentSelected')}: {selectedRecord.template.id} · {selectedRecord.lifecycle} ·{' '}
                    {getScopeLabel(selectedRecord.scope, t)}
                  </div>
                )}
                {editorMode === 'markdown' && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('settings.workflows.editorMarkdownFormatHint')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={!!pendingSaveDecision}
        onOpenChange={(open) => {
          if (!open) setPendingSaveDecision(null);
        }}
      >
        <DialogContent className="sm:max-w-lg overflow-hidden p-0">
          <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
              {t('settings.workflows.dialogs.badge')}
            </div>
          </div>
          <DialogHeader className="px-5 pt-4 text-left">
            <DialogTitle>{t('settings.workflows.saveDecision.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.workflows.saveDecision.descriptionPrefix')}
              <code>{pendingSaveDecision?.originalId}</code>
              {t('settings.workflows.saveDecision.descriptionMiddle')}
              <code>{pendingSaveDecision?.nextId}</code>
              {t('settings.workflows.saveDecision.descriptionSuffix')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('settings.workflows.saveDecision.hint')}
            </div>
          </div>
          <DialogFooter className="mt-4 gap-2 border-t border-border/70 bg-muted/20 px-5 py-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingSaveDecision(null)}
              disabled={savingDraft}
              className="h-10 rounded-xl"
            >
              {t('settings.workflows.saveDecision.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSaveDraft('new')}
              disabled={savingDraft}
              className="h-10 rounded-xl"
            >
              {t('settings.workflows.saveDecision.createNew')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveDraft('overwrite')}
              disabled={savingDraft}
              className="h-10 rounded-xl"
            >
              {t('settings.workflows.saveDecision.overwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!pendingPublishInstall}
        onOpenChange={(open) => {
          if (!open) {
            setPendingPublishInstall(null);
            setPublishInstallSelections({});
            setPublishInstallSearchBySkillRef({});
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl overflow-hidden p-0">
          <div className="border-b border-border/70 bg-muted/30 px-5 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
              {t('settings.workflows.dialogs.badge')}
            </div>
          </div>
          <DialogHeader className="px-5 pt-4 text-left">
            <DialogTitle>{t('settings.workflows.installDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('settings.workflows.installDialog.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t('settings.workflows.installDialog.summary', {
                missingCount: pendingPublishInstall?.details.missingSkillRefs.length ?? 0,
                invalidCount: pendingPublishInstall?.details.invalidSkillRefs.length ?? 0,
              })}
            </div>
          </div>
          <div className="max-h-[52vh] overflow-y-auto px-5 pr-6">
            <div className="space-y-3 py-3">
              {pendingPublishInstall?.details.invalidSkillRefs.length ? (
                <div className="surface-card-soft border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {t('settings.workflows.installDialog.invalidRefs', {
                    refs: pendingPublishInstall.details.invalidSkillRefs.join(listSeparator),
                  })}
                </div>
              ) : null}
              {!canAutoInstallForScope ? (
                <div className="surface-card-soft border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {t('settings.workflows.installDialog.scopeNotSupported')}
                </div>
              ) : null}
              {pendingPublishInstall?.details.missingSkillRefs.map((rawSkillRef) => {
                const skillRef = normalizeSkillRef(rawSkillRef);
                const options = pendingPublishInstall.details.skillInstallOptions[skillRef] ?? [];
                const candidates = pendingPublishInstall.details.skillInstallCandidates[skillRef] ?? [];
                const searchKeyword = (publishInstallSearchBySkillRef[skillRef] ?? '').trim().toLowerCase();
                const filteredCandidates = searchKeyword
                  ? candidates.filter((candidate) => {
                    const desc = candidate.description ?? '';
                    return `${candidate.package} ${desc}`.toLowerCase().includes(searchKeyword);
                  })
                  : candidates;
                const resolvedCandidates = filteredCandidates.length > 0 ? filteredCandidates : candidates;
                const recommendedPackage = candidates[0]?.package ?? '';
                const selectedValue = publishInstallSelections[skillRef] ?? '';
                return (
                  <div key={skillRef} className="surface-card-soft rounded-xl space-y-2 border border-border/70 bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-foreground">{skillRef}</div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {t('settings.workflows.installDialog.candidateCount', { count: options.length })}
                      </span>
                    </div>
                    {options.length > 1 ? (
                      <div className="mt-2">
                        <div className="mb-1 text-[11px] text-muted-foreground">{t('settings.workflows.installDialog.selectPackageHint')}</div>
                        <Input
                          value={publishInstallSearchBySkillRef[skillRef] ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPublishInstallSearchBySkillRef((prev) => ({
                              ...prev,
                              [skillRef]: value,
                            }));
                          }}
                          className="mb-2 h-8 rounded-lg border-border/70 bg-card/95 text-xs"
                          placeholder={t('settings.workflows.installDialog.searchPlaceholder')}
                        />
                        <select
                          className="h-10 w-full rounded-xl border border-border/75 bg-card/95 px-2 text-xs text-foreground"
                          value={selectedValue}
                          onChange={(event) => {
                            const value = event.target.value;
                            setPublishInstallSelections((prev) => ({
                              ...prev,
                              [skillRef]: value,
                            }));
                          }}
                        >
                          <option value="">{t('settings.workflows.installDialog.selectPlaceholder')}</option>
                          {resolvedCandidates.map((candidate) => (
                            <option key={`${skillRef}:${candidate.package}`} value={candidate.package}>
                              {candidate.package === recommendedPackage ? t('settings.workflows.installDialog.recommendedPrefix') : ''}
                              {candidate.package}
                              {candidate.installs
                                ? t('settings.workflows.installDialog.installCountSuffix', { installs: candidate.installs })
                                : ''}
                            </option>
                          ))}
                        </select>
                        {searchKeyword && filteredCandidates.length === 0 ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {t('settings.workflows.installDialog.noMatchFallback', {
                              keyword: publishInstallSearchBySkillRef[skillRef] ?? '',
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {options.length === 1 ? (
                      <div className="surface-card-soft rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-700">
                        {t('settings.workflows.installDialog.autoInstallPrefix')}
                        <code>{options[0]}</code>
                        {candidates[0]?.installs
                          ? t('settings.workflows.installDialog.autoInstallCountSuffix', { installs: candidates[0].installs })
                          : ''}
                      </div>
                    ) : null}
                    {options.length === 0 ? (
                      <div className="surface-card-soft rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
                        {t('settings.workflows.installDialog.noCandidates')}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter className="gap-2 border-t border-border/70 bg-muted/20 px-5 py-4 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingPublishInstall(null);
                setPublishInstallSelections({});
                setPublishInstallSearchBySkillRef({});
              }}
              disabled={publishingWithInstall}
              className="h-10 rounded-xl"
            >
              {t('settings.workflows.installDialog.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/settings?tab=skills')}
              disabled={publishingWithInstall}
              className="h-10 rounded-xl"
            >
              {t('settings.workflows.installDialog.goSkills')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleInstallAndPublish()}
              disabled={publishingWithInstall || !canAutoInstallForScope}
              className="h-10 rounded-xl"
            >
              {publishingWithInstall ? <Loader2 className="size-4 animate-spin" /> : null}
              {canAutoInstallForScope
                ? t('settings.workflows.installDialog.installAndPublish')
                : t('settings.workflows.installDialog.scopeNotSupportedShort')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
