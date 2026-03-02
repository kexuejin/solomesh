import {
  AGENT_PROVIDER_IDS,
  normalizeAgentProvider,
  type AgentProvider,
} from './agent-providers.js';

export type WorkflowStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled';

export type WorkflowTemplateScope = 'global' | 'user';
export type WorkflowTemplateLifecycle = 'draft' | 'published' | 'archived';
export type WorkflowStageDependencyType = 'provider' | 'skill' | 'channel' | 'mcp';
export type WorkflowStageDependencyOnMissing = 'auto_fix' | 'guide_user' | 'fallback' | 'fail';
export type WorkflowStageTodoIngestPriority = 'low' | 'medium' | 'high' | 'critical';

export interface WorkflowStageDependencyDef {
  type: WorkflowStageDependencyType;
  ref: string;
  required?: boolean;
  capability?: string;
  onMissing?: WorkflowStageDependencyOnMissing;
}

export interface WorkflowStageDef {
  id: string;
  name: string;
  defaultProvider: AgentProvider;
  strictProvider?: boolean;
  fallbackProviders?: AgentProvider[];
  goal: string;
  requiredOutputHints: string[];
  doneKeywords: string[];
  skillRefs?: string[];
  dependencies?: WorkflowStageDependencyDef[];
  todoIngest?: {
    enabled: boolean;
    priority?: WorkflowStageTodoIngestPriority;
  };
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  version: number;
  stages: WorkflowStageDef[];
  recommendedTriggers: string[];
}

export interface WorkflowTemplateRecord {
  scope: WorkflowTemplateScope;
  ownerUserId: string | null;
  lifecycle: WorkflowTemplateLifecycle;
  template: WorkflowTemplate;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface WorkflowTemplateContext {
  ownerUserId?: string | null;
}

export interface WorkflowTemplateRecordListOptions {
  ownerUserId?: string | null;
  scope?: WorkflowTemplateScope | 'all';
  lifecycle?: WorkflowTemplateLifecycle | 'all';
  includeBuiltin?: boolean;
  visibleOnly?: boolean;
}

export interface WorkflowTemplateRecordRef {
  scope: WorkflowTemplateScope;
  ownerUserId?: string | null;
  templateId: string;
  lifecycle?: WorkflowTemplateLifecycle;
}

export interface WorkflowTemplateDraftWriteInput {
  scope: WorkflowTemplateScope;
  ownerUserId?: string | null;
  template: WorkflowTemplate;
  nowIso?: string;
}

export interface WorkflowSessionState {
  chatJid: string;
  templateId: string;
  templateScope: WorkflowTemplateScope;
  templateOwnerUserId: string | null;
  templateVersion: number;
  status: WorkflowStatus;
  currentStageIndex: number;
  startedAt: string;
  updatedAt: string;
  lastStageSwitchedAt: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowPendingRecommendation {
  chatJid: string;
  templateId: string;
  templateScope: WorkflowTemplateScope;
  templateOwnerUserId: string | null;
  reason: string;
  suggestedAt: string;
  expiresAt: string;
}

export type WorkflowCommand =
  | { type: 'none' }
  | { type: 'start'; templateId: string | null }
  | { type: 'accept' }
  | { type: 'cancel' }
  | { type: 'next' }
  | { type: 'exit' }
  | { type: 'status' };

export interface WorkflowCommandParseResult {
  command: WorkflowCommand;
  hasCommand: boolean;
  contentForPrompt: string;
  isCommandOnly: boolean;
}

export interface WorkflowRecommendationMatch {
  templateId: string;
  templateScope: WorkflowTemplateScope;
  templateOwnerUserId: string | null;
  reason: string;
}

export interface WorkflowStageReport {
  stageId: string | null;
  done: boolean;
  confidence: number | null;
  evidence: string[];
  notes: string;
  raw: string;
}

export interface WorkflowStageReportParseResult {
  cleanText: string;
  report: WorkflowStageReport | null;
}

export interface WorkflowStageTransitionDecision {
  shouldAdvance: boolean;
  source: 'report' | 'keyword' | 'none';
  reason: string;
  confidence: number;
  missingHints: string[];
}

const START_COMMAND_PREFIX_RE = /^\s*\/wf(?:\s+|$)(?<rest>[\s\S]*)$/i;
const COMMAND_PREFIX_RE =
  /^\s*\/wf-(?<cmd>accept|cancel|next|exit|status)(?:\s+|$)(?<rest>[\s\S]*)$/i;
const STAGE_REPORT_BLOCK_RE = /<workflow_stage_report>([\s\S]*?)<\/workflow_stage_report>/gi;
const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const STAGE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const WORKFLOW_STAGE_DEPENDENCY_TYPES: WorkflowStageDependencyType[] = [
  'provider',
  'skill',
  'channel',
  'mcp',
];
const WORKFLOW_STAGE_DEPENDENCY_ON_MISSING: WorkflowStageDependencyOnMissing[] = [
  'auto_fix',
  'guide_user',
  'fallback',
  'fail',
];
const WORKFLOW_STAGE_TODO_INGEST_PRIORITIES: WorkflowStageTodoIngestPriority[] = [
  'low',
  'medium',
  'high',
  'critical',
];

export const WORKFLOW_RECOMMENDATION_TTL_MS = 20 * 60 * 1000;

const BUILTIN_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'analysis-heavy',
    name: 'Analysis Heavy',
    description: '分析优先，先深度调研再规划和实现。',
    version: 1,
    recommendedTriggers: ['调研', '分析', 'architecture', 'review', 'risk'],
    stages: [
      {
        id: 'clarify',
        name: '需求澄清',
        defaultProvider: 'claude',
        goal: '快速识别关键信息缺口、边界和验收标准。',
        requiredOutputHints: ['疑问清单', '范围边界', '验收标准'],
        doneKeywords: ['澄清完成', 'clarification done'],
      },
      {
        id: 'deep-analysis',
        name: '深度分析',
        defaultProvider: 'codex',
        goal: '做系统性检索与证据归纳，形成分析报告。',
        requiredOutputHints: ['证据', '风险', '结论'],
        doneKeywords: ['分析完成', 'analysis done'],
      },
      {
        id: 'plan',
        name: '任务规划',
        defaultProvider: 'claude',
        goal: '基于分析制定可执行步骤和验证方案。',
        requiredOutputHints: ['实施步骤', '影响范围', '测试策略'],
        doneKeywords: ['计划完成', 'plan done'],
      },
      {
        id: 'implementation',
        name: '代码执行',
        defaultProvider: 'claude',
        goal: '完成代码变更并回报验证结果。',
        requiredOutputHints: ['改动说明', '验证结果'],
        doneKeywords: ['实现完成', 'implementation done'],
      },
      {
        id: 'review-gate',
        name: '质量审查',
        defaultProvider: 'codex',
        goal: '深度审查缺陷、风险和回归点。',
        requiredOutputHints: ['问题清单', '风险等级', '建议'],
        doneKeywords: ['审查完成', 'review done'],
      },
      {
        id: 'decision',
        name: '最终决策',
        defaultProvider: 'claude',
        goal: '综合审查结果给出最终决策与下一步。',
        requiredOutputHints: ['go/no-go', '后续动作'],
        doneKeywords: ['决策完成', 'decision done'],
      },
    ],
  },
  {
    id: 'feature-delivery',
    name: 'Feature Delivery',
    description: '功能交付路径：澄清、计划、实现、验收。',
    version: 1,
    recommendedTriggers: ['feature', '需求', '实现', '开发', 'delivery'],
    stages: [
      {
        id: 'clarify',
        name: '需求澄清',
        defaultProvider: 'claude',
        goal: '明确目标、范围和验收口径。',
        requiredOutputHints: ['目标', '范围', '验收标准'],
        doneKeywords: ['澄清完成', 'clarification done'],
      },
      {
        id: 'plan',
        name: '实施计划',
        defaultProvider: 'claude',
        goal: '拆解任务并明确实现顺序。',
        requiredOutputHints: ['步骤', '依赖', '风险'],
        doneKeywords: ['计划完成', 'plan done'],
      },
      {
        id: 'implementation',
        name: '开发实现',
        defaultProvider: 'codex',
        goal: '交付代码并提供验证证据。',
        requiredOutputHints: ['改动', '测试'],
        doneKeywords: ['实现完成', 'implementation done'],
      },
      {
        id: 'verification',
        name: '质量验收',
        defaultProvider: 'codex',
        goal: '独立审查质量与回归风险。',
        requiredOutputHints: ['缺陷', '风险', '结论'],
        doneKeywords: ['验收完成', 'verification done'],
      },
    ],
  },
  {
    id: 'review-gate',
    name: 'Review Gate',
    description: '以审查为主：先实现摘要，再深审查，最后决策。',
    version: 1,
    recommendedTriggers: ['review', '审查', '质量', '风险', '安全'],
    stages: [
      {
        id: 'context',
        name: '上下文整理',
        defaultProvider: 'claude',
        goal: '提炼当前改动上下文与目标。',
        requiredOutputHints: ['背景', '改动摘要'],
        doneKeywords: ['整理完成', 'context done'],
      },
      {
        id: 'deep-review',
        name: '深度审查',
        defaultProvider: 'codex',
        goal: '产出按严重级别排序的问题列表。',
        requiredOutputHints: ['severity', '定位', '修复建议'],
        doneKeywords: ['审查完成', 'review done'],
      },
      {
        id: 'final-decision',
        name: '最终决策',
        defaultProvider: 'claude',
        goal: '确认是否合并及后续修复动作。',
        requiredOutputHints: ['决策', '下一步'],
        doneKeywords: ['决策完成', 'decision done'],
      },
    ],
  },
  {
    id: 'competitor-watch',
    name: 'Competitor Watch',
    description: '竞品追踪路径：抓取动态、评估影响、沉淀 Todo。',
    version: 1,
    recommendedTriggers: ['竞品', '竞争对手', 'pricing', 'pricing page', '发布动态', '功能更新', 'competitor'],
    stages: [
      {
        id: 'collect-signals',
        name: '竞品信号收集',
        defaultProvider: 'codex',
        goal: '收集近期竞品功能、定价、公告和发布变化。',
        requiredOutputHints: ['变化点', '证据链接', '时间范围'],
        doneKeywords: ['收集完成', 'signal collected'],
        skillRefs: ['competitor-tracker'],
        todoIngest: {
          enabled: false,
        },
      },
      {
        id: 'impact-assessment',
        name: '影响评估',
        defaultProvider: 'claude',
        goal: '评估变化对当前项目的影响和优先级。',
        requiredOutputHints: ['影响评估', '优先级', '建议动作'],
        doneKeywords: ['评估完成', 'assessment done'],
        todoIngest: {
          enabled: false,
        },
      },
      {
        id: 'emit-todo',
        name: 'Todo 输出',
        defaultProvider: 'claude',
        goal: '输出可执行 Todo 候选并附带 evidence 与 dedupe 建议。',
        requiredOutputHints: ['todo标题', 'evidence', 'dedupe建议'],
        doneKeywords: ['todo完成', 'todo emitted'],
        todoIngest: {
          enabled: true,
          priority: 'high',
        },
      },
    ],
  },
  {
    id: 'project-recommendation',
    name: 'Project Recommendation',
    description: '项目推荐路径：发现候选、评分筛选、沉淀 Todo。',
    version: 1,
    recommendedTriggers: ['项目推荐', '推荐项目', '新项目', '开源项目', 'project recommendation', 'project radar'],
    stages: [
      {
        id: 'collect-candidates',
        name: '候选收集',
        defaultProvider: 'codex',
        goal: '收集近期值得关注的项目与工具候选。',
        requiredOutputHints: ['候选列表', '来源', '背景'],
        doneKeywords: ['候选完成', 'candidate collected'],
        skillRefs: ['project-recommender'],
        todoIngest: {
          enabled: false,
        },
      },
      {
        id: 'score-filter',
        name: '评分筛选',
        defaultProvider: 'claude',
        goal: '基于相关性、影响力、落地成本进行评分筛选。',
        requiredOutputHints: ['评分', '筛选理由', '风险提示'],
        doneKeywords: ['筛选完成', 'filter done'],
        todoIngest: {
          enabled: false,
        },
      },
      {
        id: 'emit-todo',
        name: 'Todo 输出',
        defaultProvider: 'claude',
        goal: '输出可执行推荐 Todo 与下一步动作。',
        requiredOutputHints: ['todo标题', '推荐理由', '下一步动作'],
        doneKeywords: ['todo完成', 'todo emitted'],
        todoIngest: {
          enabled: true,
          priority: 'medium',
        },
      },
    ],
  },
];

const BUILTIN_TEMPLATE_RECORDS: WorkflowTemplateRecord[] = BUILTIN_WORKFLOW_TEMPLATES.map((template) => {
  const nowIso = new Date(0).toISOString();
  return {
    scope: 'global',
    ownerUserId: null,
    lifecycle: 'published',
    template: cloneWorkflowTemplate(template),
    isBuiltin: true,
    createdAt: nowIso,
    updatedAt: nowIso,
    publishedAt: nowIso,
  };
});

const BUILTIN_TEMPLATE_MAP = new Map(
  BUILTIN_TEMPLATE_RECORDS.map((record) => [record.template.id, record]),
);

const workflowTemplateRegistry = new Map<string, WorkflowTemplateRecord>();

function compareTemplateIdAsc(a: WorkflowTemplateRecord, b: WorkflowTemplateRecord): number {
  return a.template.id.localeCompare(b.template.id);
}

function cloneWorkflowStage(stage: WorkflowStageDef): WorkflowStageDef {
  const cloned: WorkflowStageDef = {
    ...stage,
    requiredOutputHints: [...stage.requiredOutputHints],
    doneKeywords: [...stage.doneKeywords],
  };
  if (Array.isArray(stage.fallbackProviders)) {
    cloned.fallbackProviders = [...stage.fallbackProviders];
  }
  if (Array.isArray(stage.skillRefs)) {
    cloned.skillRefs = [...stage.skillRefs];
  }
  if (Array.isArray(stage.dependencies)) {
    cloned.dependencies = stage.dependencies.map((dependency) => ({ ...dependency }));
  }
  if (stage.todoIngest) {
    cloned.todoIngest = { ...stage.todoIngest };
  }
  return cloned;
}

function cloneWorkflowTemplate(template: WorkflowTemplate): WorkflowTemplate {
  return {
    ...template,
    stages: template.stages.map(cloneWorkflowStage),
    recommendedTriggers: [...template.recommendedTriggers],
  };
}

function cloneWorkflowTemplateRecord(record: WorkflowTemplateRecord): WorkflowTemplateRecord {
  return {
    ...record,
    template: cloneWorkflowTemplate(record.template),
  };
}

function normalizeTemplateId(templateId: string | null | undefined): string | null {
  if (typeof templateId !== 'string') return null;
  const normalized = templateId.trim().toLowerCase();
  if (!TEMPLATE_ID_RE.test(normalized)) return null;
  return normalized;
}

function normalizeStageId(stageId: string | null | undefined): string | null {
  if (typeof stageId !== 'string') return null;
  const normalized = stageId.trim().toLowerCase();
  if (!STAGE_ID_RE.test(normalized)) return null;
  return normalized;
}

function normalizeScope(value: unknown): WorkflowTemplateScope {
  return value === 'user' ? 'user' : 'global';
}

function normalizeLifecycle(value: unknown): WorkflowTemplateLifecycle {
  if (value === 'draft' || value === 'archived') return value;
  return 'published';
}

function normalizeOwnerUserIdByScope(
  scope: WorkflowTemplateScope,
  ownerUserId: string | null | undefined,
): string | null {
  if (scope !== 'user') return null;
  if (typeof ownerUserId !== 'string') return null;
  const normalized = ownerUserId.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildTemplateRecordKey(
  scope: WorkflowTemplateScope,
  ownerUserId: string | null,
  templateId: string,
  lifecycle: WorkflowTemplateLifecycle,
): string {
  return `${scope}:${ownerUserId ?? ''}:${templateId}:${lifecycle}`;
}

function sanitizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function normalizeWorkflowStageDependencyType(value: unknown): WorkflowStageDependencyType | null {
  return WORKFLOW_STAGE_DEPENDENCY_TYPES.includes(value as WorkflowStageDependencyType)
    ? (value as WorkflowStageDependencyType)
    : null;
}

function normalizeWorkflowStageDependencyOnMissing(
  value: unknown,
): WorkflowStageDependencyOnMissing {
  return WORKFLOW_STAGE_DEPENDENCY_ON_MISSING.includes(value as WorkflowStageDependencyOnMissing)
    ? (value as WorkflowStageDependencyOnMissing)
    : 'guide_user';
}

function sanitizeWorkflowStageDependencies(value: unknown): WorkflowStageDependencyDef[] {
  if (!Array.isArray(value)) return [];
  const dependencies: WorkflowStageDependencyDef[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = normalizeWorkflowStageDependencyType(item.type);
    if (!type) continue;
    const ref = sanitizeString(item.ref).toLowerCase();
    if (!ref) continue;
    const key = `${type}:${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const required = item.required !== false;
    const onMissing = normalizeWorkflowStageDependencyOnMissing(item.onMissing);
    const capability = sanitizeString(item.capability);
    dependencies.push({
      type,
      ref,
      required,
      ...(capability ? { capability } : {}),
      onMissing,
    });
  }

  return dependencies;
}

function normalizeWorkflowStageTodoIngestPriority(
  value: unknown,
): WorkflowStageTodoIngestPriority | null {
  if (WORKFLOW_STAGE_TODO_INGEST_PRIORITIES.includes(value as WorkflowStageTodoIngestPriority)) {
    return value as WorkflowStageTodoIngestPriority;
  }
  return null;
}

function sanitizeWorkflowStageTodoIngest(
  value: unknown,
): WorkflowStageDef['todoIngest'] | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const enabled = item.enabled !== false;
  const priority = normalizeWorkflowStageTodoIngestPriority(item.priority);
  return {
    enabled,
    ...(priority ? { priority } : {}),
  };
}

function sanitizeWorkflowStage(value: unknown): WorkflowStageDef | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = normalizeStageId(typeof item.id === 'string' ? item.id : null);
  if (!id) return null;
  const name = sanitizeString(item.name);
  if (!name) return null;
  const defaultProvider: AgentProvider = normalizeAgentProvider(item.defaultProvider);
  const fallbackProviders = (
    Array.isArray(item.fallbackProviders)
      ? item.fallbackProviders
      : []
  )
    .filter(
      (provider): provider is AgentProvider =>
        (AGENT_PROVIDER_IDS as readonly unknown[]).includes(provider),
    )
    .filter((provider, index, array) => array.indexOf(provider) === index);
  const strictProvider = item.strictProvider === true;
  const goal = sanitizeString(item.goal);
  const skillRefs = sanitizeStringArray(item.skillRefs);
  const dependencies = sanitizeWorkflowStageDependencies(item.dependencies);
  const todoIngest = sanitizeWorkflowStageTodoIngest(item.todoIngest);
  return {
    id,
    name,
    defaultProvider,
    ...(strictProvider ? { strictProvider: true } : {}),
    ...(fallbackProviders.length > 0 ? { fallbackProviders } : {}),
    goal,
    requiredOutputHints: sanitizeStringArray(item.requiredOutputHints),
    doneKeywords: sanitizeStringArray(item.doneKeywords),
    ...(skillRefs.length > 0 ? { skillRefs } : {}),
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...(todoIngest ? { todoIngest } : {}),
  };
}

function sanitizeWorkflowTemplate(
  value: unknown,
  forcedTemplateId?: string | null,
): WorkflowTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = forcedTemplateId ?? normalizeTemplateId(typeof item.id === 'string' ? item.id : null);
  if (!id) return null;
  const name = sanitizeString(item.name);
  if (!name) return null;
  const description = sanitizeString(item.description);
  const versionRaw = typeof item.version === 'number' ? Math.floor(item.version) : 1;
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;
  const stagesRaw = Array.isArray(item.stages) ? item.stages : [];
  const stages = stagesRaw
    .map((stage) => sanitizeWorkflowStage(stage))
    .filter((stage): stage is WorkflowStageDef => !!stage);
  if (stages.length === 0) return null;

  return {
    id,
    name,
    description,
    version,
    stages,
    recommendedTriggers: sanitizeStringArray(item.recommendedTriggers),
  };
}

function sanitizeIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? fallback : new Date(ts).toISOString();
}

function sanitizeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function getCustomTemplateRecordByKey(
  scope: WorkflowTemplateScope,
  ownerUserId: string | null,
  templateId: string,
  lifecycle: WorkflowTemplateLifecycle,
): WorkflowTemplateRecord | null {
  const key = buildTemplateRecordKey(scope, ownerUserId, templateId, lifecycle);
  return workflowTemplateRegistry.get(key) ?? null;
}

function listCustomTemplateRecordsByScope(
  scope: WorkflowTemplateScope,
  ownerUserId: string | null,
): WorkflowTemplateRecord[] {
  const result: WorkflowTemplateRecord[] = [];
  for (const record of workflowTemplateRegistry.values()) {
    if (record.scope !== scope) continue;
    if (scope === 'user' && record.ownerUserId !== ownerUserId) continue;
    if (scope === 'global' && record.ownerUserId !== null) continue;
    result.push(record);
  }
  result.sort(compareTemplateIdAsc);
  return result;
}

function getVisiblePublishedTemplateRecords(ownerUserId: string | null): WorkflowTemplateRecord[] {
  const seen = new Set<string>();
  const records: WorkflowTemplateRecord[] = [];

  if (ownerUserId) {
    const userRecords = listCustomTemplateRecordsByScope('user', ownerUserId)
      .filter((record) => record.lifecycle === 'published');
    for (const record of userRecords) {
      if (seen.has(record.template.id)) continue;
      seen.add(record.template.id);
      records.push(record);
    }
  }

  const globalRecords = listCustomTemplateRecordsByScope('global', null)
    .filter((record) => record.lifecycle === 'published');
  for (const record of globalRecords) {
    if (seen.has(record.template.id)) continue;
    seen.add(record.template.id);
    records.push(record);
  }

  for (const record of BUILTIN_TEMPLATE_RECORDS) {
    if (seen.has(record.template.id)) continue;
    seen.add(record.template.id);
    records.push(record);
  }

  return records;
}

function getTemplateRecordForState(state: WorkflowSessionState | null): WorkflowTemplateRecord | null {
  if (!state) return null;
  const templateId = normalizeTemplateId(state.templateId);
  if (!templateId) return null;

  const scope = normalizeScope(state.templateScope);
  const ownerUserId = normalizeOwnerUserIdByScope(scope, state.templateOwnerUserId);
  const customLifecycleOrder: WorkflowTemplateLifecycle[] = ['published', 'archived', 'draft'];

  for (const lifecycle of customLifecycleOrder) {
    const scoped = getCustomTemplateRecordByKey(scope, ownerUserId, templateId, lifecycle);
    if (scoped) return scoped;
  }

  if (scope === 'global') {
    const builtin = BUILTIN_TEMPLATE_MAP.get(templateId);
    if (builtin) return builtin;
  }

  const visible = getVisiblePublishedTemplateRecords(ownerUserId);
  return visible.find((record) => record.template.id === templateId) ?? null;
}

export function getWorkflowTemplateRecordForSession(
  state: WorkflowSessionState | null,
): WorkflowTemplateRecord | null {
  const record = getTemplateRecordForState(state);
  return record ? cloneWorkflowTemplateRecord(record) : null;
}

export function getWorkflowTemplateForSession(
  state: WorkflowSessionState | null,
): WorkflowTemplate | null {
  const record = getTemplateRecordForState(state);
  return record ? cloneWorkflowTemplate(record.template) : null;
}

function assertWritableScopeOwner(scope: WorkflowTemplateScope, ownerUserId: string | null): void {
  if (scope === 'user' && !ownerUserId) {
    throw new Error('ownerUserId is required for user scoped workflow templates');
  }
}

function nextPublishedVersion(
  published: WorkflowTemplateRecord | null,
  draft: WorkflowTemplateRecord,
): number {
  if (!published) {
    return Math.max(1, Math.floor(draft.template.version || 1));
  }
  return Math.max(published.template.version + 1, Math.floor(draft.template.version || 1));
}

export function loadWorkflowTemplateRegistry(raw: string | undefined): void {
  const parsed = parseWorkflowTemplateRegistry(raw);
  workflowTemplateRegistry.clear();
  for (const record of parsed) {
    const key = buildTemplateRecordKey(
      record.scope,
      record.ownerUserId,
      record.template.id,
      record.lifecycle,
    );
    workflowTemplateRegistry.set(key, record);
  }
}

export function serializeWorkflowTemplateRegistry(): string {
  const payload = Array.from(workflowTemplateRegistry.values())
    .sort((a, b) => {
      const keyA = buildTemplateRecordKey(a.scope, a.ownerUserId, a.template.id, a.lifecycle);
      const keyB = buildTemplateRecordKey(b.scope, b.ownerUserId, b.template.id, b.lifecycle);
      return keyA.localeCompare(keyB);
    })
    .map((record) => ({
      scope: record.scope,
      ownerUserId: record.ownerUserId,
      lifecycle: record.lifecycle,
      template: cloneWorkflowTemplate(record.template),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      publishedAt: record.publishedAt,
    }));
  return JSON.stringify(payload);
}

export function parseWorkflowTemplateRegistry(
  raw: string | undefined,
): WorkflowTemplateRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : (
        parsed
        && typeof parsed === 'object'
        && Array.isArray((parsed as { records?: unknown }).records)
      )
        ? (parsed as { records: unknown[] }).records
        : [];

    const nowIso = new Date().toISOString();
    const records: WorkflowTemplateRecord[] = [];
    for (const rawEntry of entries) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      const scope = normalizeScope(entry.scope);
      const ownerUserId = normalizeOwnerUserIdByScope(scope, entry.ownerUserId as string | null | undefined);
      if (scope === 'user' && !ownerUserId) continue;
      const lifecycle = normalizeLifecycle(entry.lifecycle);
      const template = sanitizeWorkflowTemplate(entry.template);
      if (!template) continue;
      const createdAt = sanitizeIso(entry.createdAt, nowIso);
      const updatedAt = sanitizeIso(entry.updatedAt, nowIso);
      const publishedAt = typeof entry.publishedAt === 'string'
        ? sanitizeIso(entry.publishedAt, nowIso)
        : null;
      records.push({
        scope,
        ownerUserId,
        lifecycle,
        template,
        isBuiltin: false,
        createdAt,
        updatedAt,
        publishedAt: lifecycle === 'published'
          ? (publishedAt ?? updatedAt)
          : null,
      });
    }

    const dedup = new Map<string, WorkflowTemplateRecord>();
    for (const record of records) {
      const key = buildTemplateRecordKey(
        record.scope,
        record.ownerUserId,
        record.template.id,
        record.lifecycle,
      );
      dedup.set(key, record);
    }
    return Array.from(dedup.values());
  } catch {
    return [];
  }
}

export function listWorkflowTemplateRecords(
  options: WorkflowTemplateRecordListOptions = {},
): WorkflowTemplateRecord[] {
  const ownerUserId = normalizeOwnerUserIdByScope('user', options.ownerUserId);

  if (options.visibleOnly) {
    return getVisiblePublishedTemplateRecords(ownerUserId)
      .map((record) => cloneWorkflowTemplateRecord(record));
  }

  const scope = options.scope ?? 'all';
  const lifecycle = options.lifecycle ?? 'all';
  const includeBuiltin = options.includeBuiltin ?? true;

  const records: WorkflowTemplateRecord[] = [];

  const includeScope = (recordScope: WorkflowTemplateScope): boolean => (
    scope === 'all' || scope === recordScope
  );

  for (const record of workflowTemplateRegistry.values()) {
    if (!includeScope(record.scope)) continue;
    if (lifecycle !== 'all' && record.lifecycle !== lifecycle) continue;
    if (record.scope === 'user' && ownerUserId && record.ownerUserId !== ownerUserId) continue;
    if (record.scope === 'user' && options.ownerUserId === null) continue;
    records.push(cloneWorkflowTemplateRecord(record));
  }

  if (
    includeBuiltin
    && includeScope('global')
    && (lifecycle === 'all' || lifecycle === 'published')
  ) {
    for (const record of BUILTIN_TEMPLATE_RECORDS) {
      records.push(cloneWorkflowTemplateRecord(record));
    }
  }

  records.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    const ownerA = a.ownerUserId ?? '';
    const ownerB = b.ownerUserId ?? '';
    if (ownerA !== ownerB) return ownerA.localeCompare(ownerB);
    if (a.template.id !== b.template.id) return a.template.id.localeCompare(b.template.id);
    return a.lifecycle.localeCompare(b.lifecycle);
  });

  return records;
}

export function listWorkflowTemplates(
  context: WorkflowTemplateContext = {},
): WorkflowTemplate[] {
  return getVisiblePublishedTemplateRecords(
    normalizeOwnerUserIdByScope('user', context.ownerUserId),
  ).map((record) => cloneWorkflowTemplate(record.template));
}

export function listWorkflowTemplateIds(
  context: WorkflowTemplateContext = {},
): string[] {
  return listWorkflowTemplates(context).map((template) => template.id);
}

export function collectWorkflowTemplateSkillRefs(template: WorkflowTemplate): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const stage of template.stages) {
    if (Array.isArray(stage.skillRefs)) {
      for (const raw of stage.skillRefs) {
        const ref = raw.trim();
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
      }
    }
    if (Array.isArray(stage.dependencies)) {
      for (const dependency of stage.dependencies) {
        if (dependency.type !== 'skill') continue;
        const ref = dependency.ref.trim();
        if (!ref || seen.has(ref)) continue;
        seen.add(ref);
        refs.push(ref);
      }
    }
  }
  return refs;
}

export function getWorkflowTemplateRecordByRef(
  ref: WorkflowTemplateRecordRef,
): WorkflowTemplateRecord | null {
  const templateId = normalizeTemplateId(ref.templateId);
  if (!templateId) return null;
  const scope = normalizeScope(ref.scope);
  const ownerUserId = normalizeOwnerUserIdByScope(scope, ref.ownerUserId);

  if (scope === 'user' && !ownerUserId) return null;

  if (ref.lifecycle) {
    const custom = getCustomTemplateRecordByKey(scope, ownerUserId, templateId, ref.lifecycle);
    if (custom) return cloneWorkflowTemplateRecord(custom);
    if (
      scope === 'global'
      && ref.lifecycle === 'published'
      && BUILTIN_TEMPLATE_MAP.has(templateId)
    ) {
      return cloneWorkflowTemplateRecord(BUILTIN_TEMPLATE_MAP.get(templateId)!);
    }
    return null;
  }

  const lifecycleOrder: WorkflowTemplateLifecycle[] = ['published', 'draft', 'archived'];
  for (const lifecycle of lifecycleOrder) {
    const custom = getCustomTemplateRecordByKey(scope, ownerUserId, templateId, lifecycle);
    if (custom) return cloneWorkflowTemplateRecord(custom);
  }
  if (scope === 'global') {
    const builtin = BUILTIN_TEMPLATE_MAP.get(templateId);
    if (builtin) return cloneWorkflowTemplateRecord(builtin);
  }
  return null;
}

export function getWorkflowTemplateRecord(
  templateId: string,
  context: WorkflowTemplateContext = {},
): WorkflowTemplateRecord | null {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  if (!normalizedTemplateId) return null;
  const ownerUserId = normalizeOwnerUserIdByScope('user', context.ownerUserId);

  if (ownerUserId) {
    const userRecord = getCustomTemplateRecordByKey(
      'user',
      ownerUserId,
      normalizedTemplateId,
      'published',
    );
    if (userRecord) return cloneWorkflowTemplateRecord(userRecord);
  }

  const globalRecord = getCustomTemplateRecordByKey(
    'global',
    null,
    normalizedTemplateId,
    'published',
  );
  if (globalRecord) return cloneWorkflowTemplateRecord(globalRecord);

  const builtin = BUILTIN_TEMPLATE_MAP.get(normalizedTemplateId);
  return builtin ? cloneWorkflowTemplateRecord(builtin) : null;
}

export function getWorkflowTemplate(
  templateId: string,
  context: WorkflowTemplateContext = {},
): WorkflowTemplate | null {
  const record = getWorkflowTemplateRecord(templateId, context);
  return record ? cloneWorkflowTemplate(record.template) : null;
}

export function upsertWorkflowTemplateDraft(
  input: WorkflowTemplateDraftWriteInput,
): WorkflowTemplateRecord {
  const scope = normalizeScope(input.scope);
  const ownerUserId = normalizeOwnerUserIdByScope(scope, input.ownerUserId);
  assertWritableScopeOwner(scope, ownerUserId);

  const forcedTemplateId = normalizeTemplateId(input.template.id);
  if (!forcedTemplateId) {
    throw new Error('Invalid workflow template id');
  }

  const template = sanitizeWorkflowTemplate(input.template, forcedTemplateId);
  if (!template) {
    throw new Error('Invalid workflow template payload');
  }

  const nowIso = sanitizeIso(input.nowIso, new Date().toISOString());
  const draftKey = buildTemplateRecordKey(scope, ownerUserId, template.id, 'draft');
  const existingDraft = workflowTemplateRegistry.get(draftKey);
  const nextDraft: WorkflowTemplateRecord = {
    scope,
    ownerUserId,
    lifecycle: 'draft',
    template,
    isBuiltin: false,
    createdAt: existingDraft?.createdAt ?? nowIso,
    updatedAt: nowIso,
    publishedAt: null,
  };

  workflowTemplateRegistry.set(draftKey, nextDraft);
  return cloneWorkflowTemplateRecord(nextDraft);
}

export function publishWorkflowTemplateDraft(
  ref: Pick<WorkflowTemplateRecordRef, 'scope' | 'ownerUserId' | 'templateId'>,
  nowIso = new Date().toISOString(),
): WorkflowTemplateRecord | null {
  const templateId = normalizeTemplateId(ref.templateId);
  if (!templateId) return null;
  const scope = normalizeScope(ref.scope);
  const ownerUserId = normalizeOwnerUserIdByScope(scope, ref.ownerUserId);
  if (scope === 'user' && !ownerUserId) return null;

  const draft = getCustomTemplateRecordByKey(scope, ownerUserId, templateId, 'draft');
  if (!draft) return null;

  const publishedKey = buildTemplateRecordKey(scope, ownerUserId, templateId, 'published');
  const previousPublished = workflowTemplateRegistry.get(publishedKey) ?? null;
  const nextVersion = nextPublishedVersion(previousPublished, draft);
  const publishedAt = sanitizeIso(nowIso, new Date().toISOString());

  const nextPublished: WorkflowTemplateRecord = {
    scope,
    ownerUserId,
    lifecycle: 'published',
    template: {
      ...cloneWorkflowTemplate(draft.template),
      version: nextVersion,
    },
    isBuiltin: false,
    createdAt: previousPublished?.createdAt ?? draft.createdAt,
    updatedAt: publishedAt,
    publishedAt,
  };

  workflowTemplateRegistry.set(publishedKey, nextPublished);
  workflowTemplateRegistry.delete(
    buildTemplateRecordKey(scope, ownerUserId, templateId, 'draft'),
  );

  return cloneWorkflowTemplateRecord(nextPublished);
}

export function archiveWorkflowTemplate(
  ref: Pick<WorkflowTemplateRecordRef, 'scope' | 'ownerUserId' | 'templateId'>,
  nowIso = new Date().toISOString(),
): WorkflowTemplateRecord | null {
  const templateId = normalizeTemplateId(ref.templateId);
  if (!templateId) return null;
  const scope = normalizeScope(ref.scope);
  const ownerUserId = normalizeOwnerUserIdByScope(scope, ref.ownerUserId);
  if (scope === 'user' && !ownerUserId) return null;

  const published = getCustomTemplateRecordByKey(scope, ownerUserId, templateId, 'published');
  const draft = getCustomTemplateRecordByKey(scope, ownerUserId, templateId, 'draft');
  const source = published ?? draft;
  if (!source) return null;

  const archivedAt = sanitizeIso(nowIso, new Date().toISOString());
  const archived: WorkflowTemplateRecord = {
    scope,
    ownerUserId,
    lifecycle: 'archived',
    template: cloneWorkflowTemplate(source.template),
    isBuiltin: false,
    createdAt: source.createdAt,
    updatedAt: archivedAt,
    publishedAt: source.publishedAt,
  };

  workflowTemplateRegistry.set(
    buildTemplateRecordKey(scope, ownerUserId, templateId, 'archived'),
    archived,
  );
  workflowTemplateRegistry.delete(
    buildTemplateRecordKey(scope, ownerUserId, templateId, 'published'),
  );
  workflowTemplateRegistry.delete(
    buildTemplateRecordKey(scope, ownerUserId, templateId, 'draft'),
  );

  return cloneWorkflowTemplateRecord(archived);
}

export function parseWorkflowCommand(content: string): WorkflowCommand {
  return parseWorkflowCommandInput(content).command;
}

export function parseWorkflowCommandInput(content: string): WorkflowCommandParseResult {
  const control = content.match(COMMAND_PREFIX_RE);
  if (control) {
    const cmd = control.groups?.cmd?.toLowerCase();
    const rest = (control.groups?.rest ?? '').trimStart();
    const command: WorkflowCommand =
      cmd === 'accept'
        ? { type: 'accept' }
        : cmd === 'cancel'
          ? { type: 'cancel' }
          : cmd === 'next'
            ? { type: 'next' }
            : cmd === 'exit'
              ? { type: 'exit' }
              : cmd === 'status'
                ? { type: 'status' }
                : { type: 'none' };
    return {
      command,
      hasCommand: command.type !== 'none',
      contentForPrompt: rest,
      isCommandOnly: rest.length === 0,
    };
  }

  const start = content.match(START_COMMAND_PREFIX_RE);
  if (start) {
    const rest = (start.groups?.rest ?? '').trimStart();
    if (!rest) {
      return {
        command: { type: 'start', templateId: null },
        hasCommand: true,
        contentForPrompt: '',
        isCommandOnly: true,
      };
    }
    const firstTokenMatch = rest.match(/^(?<template>\S+)(?<remaining>[\s\S]*)$/);
    const templateId = firstTokenMatch?.groups?.template?.toLowerCase() ?? null;
    const remaining = (firstTokenMatch?.groups?.remaining ?? '').trimStart();
    return {
      command: { type: 'start', templateId },
      hasCommand: true,
      contentForPrompt: remaining,
      isCommandOnly: remaining.length === 0,
    };
  }

  return {
    command: { type: 'none' },
    hasCommand: false,
    contentForPrompt: content,
    isCommandOnly: false,
  };
}

export function isWorkflowControlCommand(content: string): boolean {
  return parseWorkflowCommand(content).type !== 'none';
}

export function createWorkflowSession(
  chatJid: string,
  template: WorkflowTemplate,
  nowIso = new Date().toISOString(),
  context: WorkflowTemplateContext & { templateScope?: WorkflowTemplateScope } = {},
): WorkflowSessionState {
  const scope = normalizeScope(context.templateScope);
  const ownerUserId = normalizeOwnerUserIdByScope(scope, context.ownerUserId);

  return {
    chatJid,
    templateId: template.id,
    templateScope: scope,
    templateOwnerUserId: ownerUserId,
    templateVersion: template.version,
    status: 'running',
    currentStageIndex: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
    lastStageSwitchedAt: nowIso,
  };
}

export function getWorkflowStage(state: WorkflowSessionState | null): WorkflowStageDef | null {
  if (!state || state.status !== 'running') return null;
  const templateRecord = getTemplateRecordForState(state);
  if (!templateRecord) return null;
  return templateRecord.template.stages[state.currentStageIndex] ?? null;
}

export function getWorkflowStageProvider(state: WorkflowSessionState | null): AgentProvider | null {
  return getWorkflowStage(state)?.defaultProvider ?? null;
}

export function advanceWorkflowStage(
  state: WorkflowSessionState,
  nowIso = new Date().toISOString(),
): { next: WorkflowSessionState; moved: boolean; completed: boolean } {
  const templateRecord = getTemplateRecordForState(state);
  if (!templateRecord) {
    return {
      next: { ...state, status: 'cancelled', updatedAt: nowIso },
      moved: false,
      completed: false,
    };
  }
  if (state.status !== 'running') {
    return { next: { ...state, updatedAt: nowIso }, moved: false, completed: false };
  }

  const lastIndex = templateRecord.template.stages.length - 1;
  if (state.currentStageIndex >= lastIndex) {
    return {
      next: {
        ...state,
        status: 'completed',
        updatedAt: nowIso,
      },
      moved: false,
      completed: true,
    };
  }

  return {
    next: {
      ...state,
      currentStageIndex: state.currentStageIndex + 1,
      updatedAt: nowIso,
      lastStageSwitchedAt: nowIso,
    },
    moved: true,
    completed: false,
  };
}

export function shouldAutoAdvanceWorkflowStage(
  state: WorkflowSessionState | null,
  text: string,
): boolean {
  const stage = getWorkflowStage(state);
  if (!stage) return false;
  const lower = text.toLowerCase();
  return stage.doneKeywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
}

function parseBooleanToken(value: string): boolean | null {
  const token = value.trim().toLowerCase();
  if (!token) return null;
  if (['true', 'yes', 'y', '1', 'done', 'completed', '完成', '是'].includes(token)) {
    return true;
  }
  if (['false', 'no', 'n', '0', 'pending', '未完成', '否'].includes(token)) {
    return false;
  }
  return null;
}

function parseConfidenceToken(value: string): number | null {
  const numeric = Number.parseFloat(value.trim());
  if (Number.isNaN(numeric)) return null;
  const normalized =
    numeric > 1 && numeric <= 100
      ? numeric / 100
      : numeric;
  if (!Number.isFinite(normalized)) return null;
  if (normalized < 0 || normalized > 1) return null;
  return normalized;
}

function normalizeForContains(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function evaluateRequiredHintCoverage(
  stage: WorkflowStageDef,
  text: string,
  report: WorkflowStageReport | null,
): { matched: string[]; missing: string[] } {
  if (stage.requiredOutputHints.length === 0) {
    return { matched: [], missing: [] };
  }
  const haystacks = [
    normalizeForContains(text),
    normalizeForContains(report?.evidence.join(' ') ?? ''),
    normalizeForContains(report?.notes ?? ''),
  ];
  const matched: string[] = [];
  const missing: string[] = [];
  for (const hint of stage.requiredOutputHints) {
    const normalizedHint = normalizeForContains(hint);
    if (!normalizedHint) continue;
    const hit = haystacks.some((haystack) => haystack.includes(normalizedHint));
    if (hit) matched.push(hint);
    else missing.push(hint);
  }
  return { matched, missing };
}

export function parseWorkflowStageReport(
  text: string,
): WorkflowStageReportParseResult {
  let match: RegExpExecArray | null;
  let lastBody: string | null = null;
  let lastRaw: string | null = null;
  STAGE_REPORT_BLOCK_RE.lastIndex = 0;
  while ((match = STAGE_REPORT_BLOCK_RE.exec(text)) !== null) {
    lastBody = match[1];
    lastRaw = match[0];
  }

  const cleanText = text.replace(STAGE_REPORT_BLOCK_RE, '').trim();
  if (!lastBody || !lastRaw) {
    return { cleanText, report: null };
  }

  const lines = lastBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let stageId: string | null = null;
  let done = false;
  let confidence: number | null = null;
  let notes = '';
  const evidence: string[] = [];
  let collectEvidence = false;

  for (const line of lines) {
    const stageMatched = line.match(/^stage[_-]?id\s*:\s*(.+)$/i);
    if (stageMatched) {
      stageId = stageMatched[1].trim() || null;
      collectEvidence = false;
      continue;
    }
    const doneMatched = line.match(/^done\s*:\s*(.+)$/i);
    if (doneMatched) {
      done = parseBooleanToken(doneMatched[1]) ?? false;
      collectEvidence = false;
      continue;
    }
    const confidenceMatched = line.match(/^confidence\s*:\s*(.+)$/i);
    if (confidenceMatched) {
      confidence = parseConfidenceToken(confidenceMatched[1]);
      collectEvidence = false;
      continue;
    }
    const notesMatched = line.match(/^notes?\s*:\s*(.+)$/i);
    if (notesMatched) {
      notes = notesMatched[1].trim();
      collectEvidence = false;
      continue;
    }
    const evidenceMatched = line.match(/^evidence\s*:\s*(.*)$/i);
    if (evidenceMatched) {
      const inline = evidenceMatched[1].trim();
      if (inline) evidence.push(inline);
      collectEvidence = true;
      continue;
    }
    const bulletMatched = line.match(/^[-*•]\s*(.+)$/);
    if (collectEvidence && bulletMatched) {
      evidence.push(bulletMatched[1].trim());
      continue;
    }
    if (collectEvidence) {
      evidence.push(line);
    }
  }

  return {
    cleanText,
    report: {
      stageId,
      done,
      confidence,
      evidence,
      notes,
      raw: lastRaw,
    },
  };
}

export function evaluateWorkflowStageTransition(
  state: WorkflowSessionState | null,
  text: string,
  report: WorkflowStageReport | null,
): WorkflowStageTransitionDecision {
  const stage = getWorkflowStage(state);
  if (!stage) {
    return {
      shouldAdvance: false,
      source: 'none',
      reason: 'workflow_not_running',
      confidence: 0,
      missingHints: [],
    };
  }

  const coverage = evaluateRequiredHintCoverage(stage, text, report);
  const hasAllRequiredHints = coverage.missing.length === 0;

  if (report && report.done) {
    const confidence = report.confidence ?? 0;
    if (report.stageId && report.stageId !== stage.id) {
      return {
        shouldAdvance: false,
        source: 'report',
        reason: `stage_mismatch:${report.stageId}->${stage.id}`,
        confidence,
        missingHints: coverage.missing,
      };
    }
    if (confidence < 0.72) {
      return {
        shouldAdvance: false,
        source: 'report',
        reason: 'confidence_low',
        confidence,
        missingHints: coverage.missing,
      };
    }
    if (!hasAllRequiredHints) {
      return {
        shouldAdvance: false,
        source: 'report',
        reason: 'required_hints_missing',
        confidence,
        missingHints: coverage.missing,
      };
    }
    return {
      shouldAdvance: true,
      source: 'report',
      reason: 'report_accepted',
      confidence,
      missingHints: [],
    };
  }

  if (shouldAutoAdvanceWorkflowStage(state, text)) {
    if (hasAllRequiredHints) {
      return {
        shouldAdvance: true,
        source: 'keyword',
        reason: 'keyword_matched',
        confidence: 0.55,
        missingHints: [],
      };
    }
    return {
      shouldAdvance: false,
      source: 'keyword',
      reason: 'keyword_without_required_hints',
      confidence: 0.55,
      missingHints: coverage.missing,
    };
  }

  return {
    shouldAdvance: false,
    source: 'none',
    reason: 'no_transition_signal',
    confidence: report?.confidence ?? 0,
    missingHints: coverage.missing,
  };
}

export function buildWorkflowStagePrompt(
  state: WorkflowSessionState | null,
  providerOverride: AgentProvider | null = null,
): string | null {
  const stage = getWorkflowStage(state);
  const templateRecord = getTemplateRecordForState(state);
  if (!stage || !templateRecord) return null;
  const activeProvider = providerOverride ?? stage.defaultProvider;
  const dependencyHints = (stage.dependencies ?? [])
    .map((dependency) => {
      const required = dependency.required !== false ? 'required' : 'optional';
      const onMissing = dependency.onMissing ?? 'guide_user';
      const capability = dependency.capability ? `#${dependency.capability}` : '';
      return `${dependency.type}:${dependency.ref}${capability} (${required}, onMissing=${onMissing})`;
    });

  return [
    `<workflow_stage template="${templateRecord.template.id}" stage="${stage.id}" provider="${activeProvider}">`,
    `当前工作流阶段：${stage.name}`,
    `阶段目标：${stage.goal}`,
    `阶段输出要求：${stage.requiredOutputHints.join('、')}`,
    ...(activeProvider !== stage.defaultProvider
      ? [`阶段执行 provider：${activeProvider}（原始配置 ${stage.defaultProvider}，因可用性自动切换）`]
      : []),
    ...(stage.skillRefs && stage.skillRefs.length > 0
      ? [`推荐技能：${stage.skillRefs.join('、')}`]
      : []),
    ...(dependencyHints.length > 0
      ? [`阶段依赖：${dependencyHints.join('；')}`]
      : []),
    '请优先完成本阶段目标，输出结果后再进入下一阶段。',
    '在回复末尾追加结构化阶段报告，格式如下：',
    '<workflow_stage_report>',
    `stage_id: ${stage.id}`,
    'done: true|false',
    'confidence: 0.00-1.00',
    'evidence:',
    '- 证据1',
    '- 证据2',
    'notes: 可选补充',
    '</workflow_stage_report>',
    '注意：仅在回复末尾添加一次该报告块。',
    '</workflow_stage>',
  ].join('\n');
}

export function formatWorkflowStatusSummary(
  state: WorkflowSessionState | null,
): string {
  if (!state) return '工作流：未启用';
  const templateRecord = getTemplateRecordForState(state);
  const templateName = templateRecord?.template.name ?? state.templateId;
  const blockedReason =
    state.status === 'paused'
      ? (() => {
        const reason = (state.metadata as { blockedReason?: unknown } | undefined)?.blockedReason;
        return typeof reason === 'string' && reason.trim().length > 0
          ? ` · ${reason.trim()}`
          : '';
      })()
      : '';
  const stage = getWorkflowStage(state);
  if (!stage || !templateRecord) {
    return `工作流：${templateName}（${state.status}）${blockedReason}`;
  }
  const totalStages = templateRecord.template.stages.length;
  return `工作流：${templateName} · 阶段 ${state.currentStageIndex + 1}/${totalStages} · ${stage.name} · ${stage.defaultProvider}${blockedReason}`;
}

function matchAny(text: string, keywords: string[]): string[] {
  return keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
}

export function resolveWorkflowRecommendation(
  content: string,
  context: WorkflowTemplateContext = {},
): WorkflowRecommendationMatch | null {
  const text = content.toLowerCase();
  if (text.length < 12) return null;

  const visibleTemplates = listWorkflowTemplateRecords({
    ownerUserId: context.ownerUserId,
    visibleOnly: true,
  });
  if (visibleTemplates.length === 0) return null;

  const scores = new Map<string, {
    score: number;
    matched: string[];
    record: WorkflowTemplateRecord;
  }>();

  for (const record of visibleTemplates) {
    const template = record.template;
    scores.set(template.id, { score: 0, matched: [], record });
    const matched = matchAny(text, template.recommendedTriggers);
    if (matched.length > 0) {
      const current = scores.get(template.id)!;
      current.score += matched.length * 2;
      current.matched.push(...matched);
    }
  }

  const highSignalGroups: Record<string, string[]> = {
    'analysis-heavy': ['调研', '分析', '架构', 'architecture', 'risk', '方案'],
    'feature-delivery': ['实现', '开发', '功能', 'feature', '交付'],
    'review-gate': ['review', '审查', '质量', '安全', '漏洞'],
    'competitor-watch': ['竞品', '竞争对手', 'pricing', '发布', '动态', 'competitor'],
    'project-recommendation': ['推荐项目', '项目推荐', '新项目', '开源', 'project', 'recommendation'],
  };

  for (const [templateId, keywords] of Object.entries(highSignalGroups)) {
    const current = scores.get(templateId);
    if (!current) continue;
    const matched = matchAny(text, keywords);
    if (matched.length > 0) {
      current.score += matched.length * 3;
      current.matched.push(...matched);
    }
  }

  const sorted = Array.from(scores.entries())
    .map(([templateId, info]) => ({
      templateId,
      score: info.score,
      matched: Array.from(new Set(info.matched)),
      record: info.record,
    }))
    .sort((a, b) => b.score - a.score);

  const best = sorted[0];
  if (!best || best.score < 4) return null;
  const reason =
    best.matched.length > 0
      ? `匹配关键词：${best.matched.slice(0, 4).join('、')}`
      : '匹配到高置信语义模式';
  return {
    templateId: best.templateId,
    templateScope: best.record.scope,
    templateOwnerUserId: best.record.ownerUserId,
    reason,
  };
}

export function parseWorkflowSessionMap(
  raw: string | undefined,
): Record<string, WorkflowSessionState> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, WorkflowSessionState> = {};
    for (const [chatJid, value] of Object.entries(parsed)) {
      const item = sanitizeObject(value);
      const templateId = normalizeTemplateId(
        typeof item.templateId === 'string' ? item.templateId : null,
      );
      if (!templateId) continue;

      const scope = normalizeScope(item.templateScope);
      const ownerUserId = normalizeOwnerUserIdByScope(
        scope,
        typeof item.templateOwnerUserId === 'string'
          ? item.templateOwnerUserId
          : null,
      );
      if (scope === 'user' && !ownerUserId) continue;

      const stateSeed: WorkflowSessionState = {
        chatJid,
        templateId,
        templateScope: scope,
        templateOwnerUserId: ownerUserId,
        templateVersion: 1,
        status: 'idle',
        currentStageIndex: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastStageSwitchedAt: new Date().toISOString(),
      };

      const templateRecord = getTemplateRecordForState(stateSeed);
      if (!templateRecord) continue;

      const statusRaw = typeof item.status === 'string' ? item.status : 'idle';
      const status: WorkflowStatus = (
        statusRaw === 'running'
        || statusRaw === 'paused'
        || statusRaw === 'completed'
        || statusRaw === 'cancelled'
        || statusRaw === 'idle'
      )
        ? statusRaw
        : 'idle';
      const now = new Date().toISOString();
      const maxStage = Math.max(0, templateRecord.template.stages.length - 1);
      const stageIndexRaw =
        typeof item.currentStageIndex === 'number'
          ? Math.floor(item.currentStageIndex)
          : 0;
      const currentStageIndex = Math.min(maxStage, Math.max(0, stageIndexRaw));
      result[chatJid] = {
        chatJid,
        templateId,
        templateScope: scope,
        templateOwnerUserId: ownerUserId,
        templateVersion:
          typeof item.templateVersion === 'number'
            ? Math.floor(item.templateVersion)
            : templateRecord.template.version,
        status,
        currentStageIndex,
        startedAt: sanitizeIso(item.startedAt, now),
        updatedAt: sanitizeIso(item.updatedAt, now),
        lastStageSwitchedAt: sanitizeIso(item.lastStageSwitchedAt, now),
        metadata: item.metadata && typeof item.metadata === 'object'
          ? item.metadata as Record<string, unknown>
          : undefined,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function parseWorkflowPendingMap(
  raw: string | undefined,
): Record<string, WorkflowPendingRecommendation> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, WorkflowPendingRecommendation> = {};
    for (const [chatJid, value] of Object.entries(parsed)) {
      const item = sanitizeObject(value);
      const templateId = normalizeTemplateId(
        typeof item.templateId === 'string' ? item.templateId : null,
      );
      if (!templateId) continue;
      const scope = normalizeScope(item.templateScope);
      const ownerUserId = normalizeOwnerUserIdByScope(
        scope,
        typeof item.templateOwnerUserId === 'string'
          ? item.templateOwnerUserId
          : null,
      );
      if (scope === 'user' && !ownerUserId) continue;
      const record = getWorkflowTemplateRecordByRef({
        scope,
        ownerUserId,
        templateId,
        lifecycle: 'published',
      });
      if (!record) continue;

      const reason = typeof item.reason === 'string' ? item.reason : '';
      const now = new Date().toISOString();
      const suggestedAt = sanitizeIso(item.suggestedAt, now);
      const expiresAt = sanitizeIso(item.expiresAt, now);
      result[chatJid] = {
        chatJid,
        templateId,
        templateScope: scope,
        templateOwnerUserId: ownerUserId,
        reason,
        suggestedAt,
        expiresAt,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function isWorkflowRecommendationExpired(
  recommendation: WorkflowPendingRecommendation,
  nowMs = Date.now(),
): boolean {
  const expiresMs = Date.parse(recommendation.expiresAt);
  if (Number.isNaN(expiresMs)) return true;
  return expiresMs <= nowMs;
}
