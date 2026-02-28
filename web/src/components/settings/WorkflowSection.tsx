import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Loader2, Plus, RefreshCw, Sparkles, Upload } from 'lucide-react';

import { api } from '../../api/client';
import {
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

interface WorkflowSectionProps extends SettingsNotification {
  canManageSystemConfig: boolean;
}

interface ListResponse {
  templates: WorkflowTemplateRecordPublic[];
}

interface TemplateAiResponse {
  provider: 'claude' | 'codex';
  templateId: string;
  template: WorkflowTemplate;
  markdown: string;
}

type AiGenerateProvider = 'auto' | 'claude' | 'codex';
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

function formatPublishDependencyError(err: unknown): string | null {
  const parsed = parsePublishDependencyDetails(err);
  if (!parsed) return null;

  const segments: string[] = [];
  if (parsed.missingSkillRefs.length > 0) {
    segments.push(`缺失技能：${parsed.missingSkillRefs.join('、')}`);
  }
  if (parsed.invalidSkillRefs.length > 0) {
    segments.push(`非法技能引用：${parsed.invalidSkillRefs.join('、')}`);
  }
  if (parsed.unresolvedSkillRefs.length > 0) {
    segments.push(`待选择安装包：${parsed.unresolvedSkillRefs.join('、')}`);
  }
  if (parsed.invalidPackageSkillRefs.length > 0) {
    segments.push(`安装包无效：${parsed.invalidPackageSkillRefs.join('、')}`);
  }
  if (parsed.availableSkillRefs.length > 0) {
    const preview = parsed.availableSkillRefs.slice(0, 12);
    segments.push(
      `当前可用技能：${preview.join('、')}${parsed.availableSkillRefs.length > preview.length ? ' 等' : ''}`,
    );
  }
  return `发布失败：${segments.join('；')}`;
}

function normalizeTemplateId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!TEMPLATE_ID_RE.test(normalized)) return null;
  return normalized;
}

function createDefaultTemplate(templateId: string): WorkflowTemplate {
  return {
    id: templateId,
    name: templateId,
    description: '',
    version: 1,
    stages: [
      {
        id: 'step-1',
        name: '阶段 1',
        defaultProvider: 'claude',
        strictProvider: false,
        fallbackProviders: ['codex'],
        goal: '',
        requiredOutputHints: [],
        doneKeywords: ['完成'],
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

function getScopeLabel(scope: WorkflowTemplateScope): string {
  return scope === 'global' ? '项目级' : '用户级';
}

function formatLocalTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
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
  const detailScopeLabel = activeRecord ? getScopeLabel(activeRecord.scope) : getScopeLabel(scope);
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
    return window.confirm(`当前有未保存修改，确认继续${actionLabel}？`);
  }, [hasUnsavedChanges]);

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
      ? '通过'
      : dependencyPrecheck.status === 'blocked'
        ? '阻塞'
        : dependencyPrecheck.status === 'error'
          ? '错误'
          : dependencyPrecheck.status === 'invalid'
            ? '格式无效'
            : dependencyPrecheck.status === 'checking'
              ? '检查中'
              : '待检查';

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
      setError(getErrorMessage(err, '加载 workflow 模板失败'));
    } finally {
      setLoading(false);
    }
  }, [scope, selectedKey, setError]);

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
              message: getErrorMessage(err, '模板格式错误，无法执行依赖预检'),
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
          segments.push(`缺失技能 ${details.missingSkillRefs.length}`);
        }
        if (details.invalidSkillRefs.length > 0) {
          segments.push(`非法技能引用 ${details.invalidSkillRefs.length}`);
        }
        setDependencyPrecheck({
          status: blocked ? 'blocked' : 'ok',
          templateId: resp.templateId,
          details,
          message: blocked
            ? `存在阻塞项：${segments.join('；')}`
            : '依赖检查通过',
        });
      } catch (err) {
        if (cancelled) return;
        setDependencyPrecheck({
          status: 'error',
          templateId: targetTemplateId || null,
          details: null,
          message: getErrorMessage(err, '依赖预检失败'),
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
  ]);

  const handleRefreshDependencyPrecheck = () => {
    setDependencyPrecheckRefreshToken((value) => value + 1);
  };

  const handleRefreshTemplates = async () => {
    if (!confirmDiscardUnsavedChanges('刷新模板列表')) return;
    await loadTemplates();
  };

  const handleScopeChange = (nextScope: WorkflowTemplateScope) => {
    if (nextScope === scope) return;
    if (!confirmDiscardUnsavedChanges('切换作用域')) return;
    setScope(nextScope);
  };

  const handleSelectRecord = (record: WorkflowTemplateRecordPublic) => {
    const nextKey = `${record.scope}:${record.template.id}:${record.lifecycle}`;
    if (nextKey !== selectedKey && !confirmDiscardUnsavedChanges('切换模板')) return;
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
    if (!confirmDiscardUnsavedChanges('切换模板')) return;
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
    setNotice(`已加载运行时模板：${record.template.id}`);
    setError(null);
  };

  const handleCreateDraft = () => {
    if (!confirmDiscardUnsavedChanges('新建模板')) return;
    setNotice(null);
    setError(null);
    const templateId = normalizeTemplateId(newTemplateId);
    if (!templateId) {
      setError('模板 ID 不合法（需 2-64 位，仅小写字母/数字/-/_）');
      return;
    }

    const template = createDefaultTemplate(templateId);
    setTemplateIdInput(templateId);
    setEditorText(serializeWorkflowTemplateForEditor(template, editorMode));
    setSelectedKey(null);
    setDetachedRecord(null);
    setPendingSaveDecision(null);
    setPanelMode('edit');
    setNotice(`已创建草稿模板骨架：${templateId}`);
  };

  const handleGenerateDraftWithAi = async () => {
    const idea = aiIdea.trim();
    if (idea.length < 8) {
      setError('请先输入更具体的模板想法（至少 8 个字符）');
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
      setNotice(`AI 已生成模板草稿：${resp.templateId}（provider: ${resp.provider}）`);
    } catch (err) {
      setError(getErrorMessage(err, 'AI 生成 workflow 模板失败'));
    } finally {
      setAiGenerating(false);
    }
  };

  const handleOptimizeTemplateWithAi = async () => {
    const instruction = aiOptimizeInstruction.trim();
    if (instruction.length < 4) {
      setError('请先输入要优化的内容（至少 4 个字符）');
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
      setNotice(`AI 已优化模板：${resp.templateId}（provider: ${resp.provider}），请确认后保存草稿`);
    } catch (err) {
      setError(getErrorMessage(err, 'AI 优化 workflow 模板失败'));
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
      setError(getErrorMessage(err, '模板格式错误，请先修正'));
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
      setError(getErrorMessage(err, '当前模板内容无法切换编辑模式，请先修正内容'));
    }
  };

  const handleResetEditorToSelected = () => {
    if (!selectedRecord) {
      setError('当前没有选中的模板可回滚');
      return;
    }
    setTemplateIdInput(selectedRecord.template.id);
    setEditorText(serializeWorkflowTemplateForEditor(selectedRecord.template, editorMode));
    setPendingSaveDecision(null);
    setNotice(`已回滚到选中模板：${selectedRecord.template.id}`);
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
      setNotice(`草稿已保存：${saved.template.id}`);
      await loadTemplates();
    } catch (err) {
      setError(getErrorMessage(err, '保存 workflow 草稿失败'));
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePublish = async () => {
    const templateId = normalizeTemplateId(templateIdInput);
    if (!templateId) {
      setError('请先选择或填写模板 ID');
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
      setNotice(`模板已发布：${saved.template.id}`);
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
        setError(formatPublishDependencyError(err));
      } else {
        setError(formatPublishDependencyError(err) ?? getErrorMessage(err, '发布 workflow 模板失败'));
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
      setError(`以下技能缺少可安装候选，请先在技能管理中手动安装：${noOptionRefs.join('、')}`);
      return;
    }
    if (unresolvedSelectionRefs.length > 0) {
      setError(`请先为以下技能选择安装包：${unresolvedSelectionRefs.join('、')}`);
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
        setNotice(`模板已发布：${saved.template.id}（已安装 ${installedCount} 个技能）`);
      } else {
        setNotice(`模板已发布：${saved.template.id}`);
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
        setError(formatPublishDependencyError(err) ?? '自动安装后仍有依赖缺失，请处理后重试');
      } else {
        setError(getErrorMessage(err, '自动安装并发布失败'));
      }
    } finally {
      setPublishingWithInstall(false);
    }
  };

  const handleArchive = async () => {
    const templateId = normalizeTemplateId(templateIdInput);
    if (!templateId) {
      setError('请先选择或填写模板 ID');
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
      setNotice(`模板已归档：${saved.template.id}`);
      await loadTemplates();
    } catch (err) {
      setError(getErrorMessage(err, '归档 workflow 模板失败'));
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
            <div className="text-sm font-semibold text-foreground">Workflow 模板管理</div>
            <div className="text-xs text-muted-foreground">
              当前作用域 {getScopeLabel(scope)} · 管理列表 {manageTemplates.length} · 运行时可见 {visibleTemplates.length}
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-muted px-2 py-0.5 text-foreground">
                Draft/Published/Archived 全生命周期
              </span>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                可见模板 {visibleTemplates.length}
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
                我的模板
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
                  项目模板
                </button>
              )}
            </div>
            <Button type="button" variant="outline" onClick={() => void handleRefreshTemplates()} className="h-10 rounded-xl">
              <RefreshCw className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4 xl:grid-cols-2">
          <div className="rounded-lg space-y-3 bg-muted/15 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">新建模板草稿</div>
              <span className="rounded-full border border-border/70 bg-card/70 px-2 py-0.5 text-[11px] text-muted-foreground">Draft</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newTemplateId}
                onChange={(e) => setNewTemplateId(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95 sm:flex-1"
                placeholder="如 feature-delivery-v2"
              />
              <Button type="button" variant="outline" onClick={handleCreateDraft} className="h-10 rounded-xl sm:shrink-0">
                <Plus className="size-4" />
                新建
              </Button>
            </div>
          </div>

          <div className="surface-card-soft rounded-xl space-y-3 border border-brand-200 bg-brand-50/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">AI 一键生成模板</div>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-700">Claude/Codex</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value as AiGenerateProvider)}
                className="h-10 rounded-xl border border-border/75 bg-card/95 px-3 text-sm text-foreground sm:w-52"
              >
                <option value="auto">自动选择 provider</option>
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerateDraftWithAi}
                disabled={aiGenerating}
                className="h-10 rounded-xl sm:shrink-0"
              >
                {aiGenerating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                AI 生成
              </Button>
            </div>
            <Textarea
              value={aiIdea}
              onChange={(e) => setAiIdea(e.target.value)}
              className="min-h-[84px] rounded-xl border-border/75 bg-card/95 text-sm"
              placeholder="输入想法，例如：先让 Claude 澄清需求，再让 Codex 编码和验收。"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="space-y-3 lg:w-2/5">
          <div className="surface-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/35 px-4 py-3">
              <div className="text-sm font-medium text-foreground">
                {scope === 'global' ? '项目模板列表' : '我的模板列表'}
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                显示 {filteredManageTemplates.length}/{manageTemplates.length}
              </span>
            </div>
            <div className="space-y-3 px-4 py-3">
              <Input
                value={templateQuery}
                onChange={(e) => setTemplateQuery(e.target.value)}
                placeholder="搜索模板 ID / 名称 / 描述"
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  { key: 'all', label: '全部', count: lifecycleCounts.all },
                  { key: 'draft', label: '草稿', count: lifecycleCounts.draft },
                  { key: 'published', label: '已发布', count: lifecycleCounts.published },
                  { key: 'archived', label: '已归档', count: lifecycleCounts.archived },
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
                    该作用域下暂无模板。
                  </div>
                )}
                {filteredManageTemplates.length === 0 && manageTemplates.length > 0 && (
                  <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
                    没有匹配的模板。
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
                          阶段 {item.template.stages.length}
                        </span>
                        {item.isBuiltin && (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700">
                            builtin
                          </span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          更新于 {formatLocalTime(item.updatedAt)}
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
              <div className="text-sm font-medium text-foreground">当前可见模板（运行时）</div>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
                {visibleTemplates.length}
              </span>
            </div>
            <div className="min-h-32 max-h-[calc(100vh-24rem)] space-y-2 overflow-y-auto px-4 py-3 pr-3">
              {visibleTemplates.length === 0 && (
                <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
                  暂无可见模板
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
                      {getScopeLabel(item.scope)}
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
                查看详情
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
                编辑模板
                {hasUnsavedChanges && (
                  <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                    未保存
                  </span>
                )}
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {panelMode === 'detail' ? '当前模式：只读详情' : '当前模式：编辑模板'}
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
                      {detailTemplate.description?.trim() ? detailTemplate.description : '暂无描述'}
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
                      {detailCallable ? '可调用' : '草稿态'}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                      阶段 {detailTemplate.stages.length}
                    </span>
                    {isGlobalReadonly && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        只读（项目模板）
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-b border-border/70 p-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/15 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">可调用命令：</span>
                    <code className="ml-2 text-xs text-foreground">/wf {detailTemplate.id}</code>
                  </div>
                  <div className="rounded-lg bg-muted/15 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Provider：</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {detailMeta.stageProviders.length > 0 ? (
                        detailMeta.stageProviders.map((provider) => (
                          <span key={provider} className="rounded bg-muted px-2 py-0.5 text-[11px] text-foreground">
                            {provider}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground">未定义</span>
                      )}
                    </div>
                  </div>
                  {detailTemplate.recommendedTriggers.length > 0 && (
                    <div className="rounded-lg bg-muted/15 px-3 py-2 text-sm sm:col-span-2">
                      <span className="text-muted-foreground">推荐触发词：</span>
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
                      更新于 {formatLocalTime(activeRecord.updatedAt)}
                      {activeRecord.publishedAt ? ` · 发布于 ${formatLocalTime(activeRecord.publishedAt)}` : ''}
                      {activeRecord.createdAt ? ` · 创建于 ${formatLocalTime(activeRecord.createdAt)}` : ''}
                    </div>
                  )}
                </div>
              </div>

              <div className="border-b border-border/70 p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">阶段定义</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    共 {detailTemplate.stages.length} 阶段
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
                  <h3 className="mb-3 text-sm font-semibold text-foreground">关联信息</h3>
                  <div className="space-y-2 text-sm">
                    {detailMeta.skillRefs.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Skills：</span>
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
                        <span className="text-muted-foreground">能力标签：</span>
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
                        <span className="text-muted-foreground">包含文件（推断）：</span>
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
                  当前为详情只读视图。切换到“编辑模板”后可修改内容、执行依赖预检并发布。
                </p>
              </div>
            </div>
          ) : (
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/70 flex items-center justify-center px-4 py-10">
              <p className="text-xs text-muted-foreground">选择一个模板后在这里查看详情与编辑。</p>
            </div>
          ))}

          {panelMode === 'edit' && (
            <div className="rounded-xl border border-border/70 bg-muted/10 space-y-4 p-4">
              <div className={`surface-card-soft rounded-xl border p-3 ${dependencyPrecheckPanelClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">发布前依赖预检</div>
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
                    重检
                  </Button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {dependencyPrecheck.status === 'idle' && '暂无可检查模板'}
                  {dependencyPrecheck.status === 'checking' && '检查中...'}
                  {dependencyPrecheck.status !== 'idle' && dependencyPrecheck.status !== 'checking' && (dependencyPrecheck.message ?? '-')}
                </div>
                {dependencyPrecheck.details && (
                  <div className="mt-2 space-y-1 text-[11px]">
                    {dependencyPrecheck.details.missingSkillRefs.length > 0 && (
                      <div className="text-amber-800">
                        缺失技能：{dependencyPrecheck.details.missingSkillRefs.join('、')}
                      </div>
                    )}
                    {dependencyPrecheck.details.invalidSkillRefs.length > 0 && (
                      <div className="text-rose-700">
                        非法技能引用：{dependencyPrecheck.details.invalidSkillRefs.join('、')}
                      </div>
                    )}
                    {dependencyPrecheck.status === 'ok' && (
                      <div className="text-emerald-700">当前模板依赖可满足，可直接发布。</div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-muted/10 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">模板名称</div>
                  <Input
                    value={detailTemplate?.name ?? ''}
                    onChange={(e) => {
                      handleQuickMetaEdit({
                        name: e.target.value,
                        description: detailTemplate?.description ?? '',
                      });
                    }}
                    placeholder="输入模板名称"
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
                <div className="rounded-lg bg-muted/10 p-3">
                  <div className="mb-2 text-sm font-medium text-foreground">模板描述</div>
                  <Textarea
                    value={detailTemplate?.description ?? ''}
                    onChange={(e) => {
                      handleQuickMetaEdit({
                        name: detailTemplate?.name ?? templateIdInput ?? 'workflow-template',
                        description: e.target.value,
                      });
                    }}
                    className="min-h-[72px] rounded-xl border-border/75 bg-card/95 text-sm"
                    placeholder="输入模板描述"
                  />
                </div>
              </div>

              <div className="rounded-lg space-y-3 bg-muted/15 p-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <div className="mb-2 text-sm font-medium text-foreground">模板 ID（保存路径）</div>
                    <Input
                      value={templateIdInput}
                      onChange={(e) => setTemplateIdInput(e.target.value)}
                      placeholder="template-id"
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
                        回滚到已选版本
                      </Button>
                    )}
                    <Button type="button" onClick={() => void handleSaveDraft()} disabled={savingDraft} className="h-10 rounded-xl">
                      {savingDraft && <Loader2 className="size-4 animate-spin" />}
                      保存草稿
                    </Button>
                    <Button type="button" variant="outline" onClick={handlePublish} disabled={publishDisabled} className="h-10 rounded-xl">
                      {publishing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                      发布
                    </Button>
                    <Button type="button" variant="outline" onClick={handleArchive} disabled={archiveDisabled} className="h-10 rounded-xl">
                      {archiving && <Loader2 className="size-4 animate-spin" />}
                      归档
                    </Button>
                  </div>
                </div>
                {isEditingSelectedTemplate && selectedRecord && (!selectedRecord.publishable || !selectedRecord.archivable) && (
                  <div className="text-xs text-muted-foreground">
                    当前模板状态限制：
                    {!selectedRecord.publishable ? ' 不可发布；' : ''}
                    {!selectedRecord.archivable ? ' 不可归档；' : ''}
                    可先保存新草稿或切换生命周期后重试。
                  </div>
                )}
              </div>

              <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50/80 p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-900">
                  <BookOpen className="size-4" />
                  AI 优化当前模板
                </div>
                <Textarea
                  value={aiOptimizeInstruction}
                  onChange={(e) => setAiOptimizeInstruction(e.target.value)}
                  className="min-h-[88px] rounded-xl border-border/75 bg-card/95 text-sm"
                  placeholder="输入要修改的内容，例如：增加验收阶段，强制 codex 执行实现阶段。"
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
                    AI 优化并回填
                  </Button>
                  <span className="text-xs text-amber-800">
                    仅回填编辑器，不会自动保存；请确认后保存草稿/发布。
                  </span>
                </div>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">模板编辑器</div>
                    {hasUnsavedChanges && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                        有未保存修改
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
                      ? '在此编辑 workflow 模板 Markdown（推荐）'
                      : '在此编辑 workflow 模板 JSON'
                  }
                />
                {selectedRecord && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    当前选中：{selectedRecord.template.id} · {selectedRecord.lifecycle} ·{' '}
                    {getScopeLabel(selectedRecord.scope)}
                  </div>
                )}
                {editorMode === 'markdown' && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    支持格式：`- id: xxx`、`## Stage: stage-id`、`- provider: claude|codex`，列表字段用 `|` 分隔。
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
              Workflow
            </div>
          </div>
          <DialogHeader className="px-5 pt-4 text-left">
            <DialogTitle>检测到模板 ID 变更</DialogTitle>
            <DialogDescription>
              当前模板 ID 从 <code>{pendingSaveDecision?.originalId}</code> 改为{' '}
              <code>{pendingSaveDecision?.nextId}</code>。请选择保存方式。
            </DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              建议先新建模板保留历史版本；只有确认需要覆盖时再使用“覆盖当前模板”。
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
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleSaveDraft('new')}
              disabled={savingDraft}
              className="h-10 rounded-xl"
            >
              新建模板（使用新 ID）
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveDraft('overwrite')}
              disabled={savingDraft}
              className="h-10 rounded-xl"
            >
              覆盖当前模板（保留原 ID）
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
              Workflow
            </div>
          </div>
          <DialogHeader className="px-5 pt-4 text-left">
            <DialogTitle>发布前安装缺失技能</DialogTitle>
            <DialogDescription>
              检测到模板依赖的技能未安装。可为每个技能选择安装包，确认后自动安装并继续发布。
            </DialogDescription>
          </DialogHeader>
          <div className="px-5">
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              缺失技能 {pendingPublishInstall?.details.missingSkillRefs.length ?? 0} 个，
              非法引用 {pendingPublishInstall?.details.invalidSkillRefs.length ?? 0} 个。
            </div>
          </div>
          <div className="max-h-[52vh] overflow-y-auto px-5 pr-6">
            <div className="space-y-3 py-3">
              {pendingPublishInstall?.details.invalidSkillRefs.length ? (
                <div className="surface-card-soft border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  非法技能引用：{pendingPublishInstall.details.invalidSkillRefs.join('、')}
                </div>
              ) : null}
              {!canAutoInstallForScope ? (
                <div className="surface-card-soft border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  当前为项目级模板，暂不支持自动安装。请先在技能管理中安装所需技能，再重新发布。
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
                        候选 {options.length}
                      </span>
                    </div>
                    {options.length > 1 ? (
                      <div className="mt-2">
                        <div className="mb-1 text-[11px] text-muted-foreground">可选安装包（请选择一个）</div>
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
                          placeholder="筛选候选包（包名/描述）"
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
                          <option value="">请选择安装包</option>
                          {resolvedCandidates.map((candidate) => (
                            <option key={`${skillRef}:${candidate.package}`} value={candidate.package}>
                              {candidate.package === recommendedPackage ? '⭐推荐 · ' : ''}
                              {candidate.package}
                              {candidate.installs ? ` · ${candidate.installs} installs` : ''}
                            </option>
                          ))}
                        </select>
                        {searchKeyword && filteredCandidates.length === 0 ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            没有匹配“{publishInstallSearchBySkillRef[skillRef]}”的候选，已回退显示全部选项。
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {options.length === 1 ? (
                      <div className="surface-card-soft rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-700">
                        将自动安装：
                        <code>{options[0]}</code>
                        {candidates[0]?.installs ? `（${candidates[0].installs} installs）` : ''}
                      </div>
                    ) : null}
                    {options.length === 0 ? (
                      <div className="surface-card-soft rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
                        未找到可安装候选包，请前往技能管理手动安装后重试发布。
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
              取消
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/settings?tab=skills')}
              disabled={publishingWithInstall}
              className="h-10 rounded-xl"
            >
              去技能管理
            </Button>
            <Button
              type="button"
              onClick={() => void handleInstallAndPublish()}
              disabled={publishingWithInstall || !canAutoInstallForScope}
              className="h-10 rounded-xl"
            >
              {publishingWithInstall ? <Loader2 className="size-4 animate-spin" /> : null}
              {canAutoInstallForScope ? '安装并发布' : '项目级不支持自动安装'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
