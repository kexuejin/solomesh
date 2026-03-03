import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  AGENT_PROVIDER_IDS,
  isAgentProviderConfigured,
  normalizeAgentProvider,
  type AgentProvider,
} from '../agent-providers.js';
import { runContainerAgent, runHostAgent } from '../container-runner.js';
import type { Variables } from '../web-context.js';
import { authMiddleware } from '../middleware/auth.js';
import {
  ensureChatExists,
  getRegisteredGroup,
  getUserHomeGroup,
  setRouterState,
  storeMessageDirect,
} from '../db.js';
import { broadcastNewMessage } from '../web.js';
import { hasPermission } from '../permissions.js';
import { getRuntimeProviderConfig } from '../runtime-config.js';
import { extractWorkflowTemplateJsonCandidate } from '../workflow-template-edit.js';
import type { AuthUser } from '../types.js';
import { logger } from '../logger.js';
import { DATA_DIR } from '../config.js';
import {
  canAccessGroup,
  hasHostExecutionPermission,
  isHostExecutionGroup,
} from '../web-context.js';
import {
  archiveWorkflowTemplate,
  collectWorkflowTemplateSkillRefs,
  getWorkflowTemplateRecordByRef,
  listWorkflowTemplateRecords,
  publishWorkflowTemplateDraft,
  serializeWorkflowTemplateRegistry,
  upsertWorkflowTemplateDraft,
  type WorkflowTemplate,
  type WorkflowTemplateRecord,
  type WorkflowTemplateScope,
} from '../workflow.js';
import { checkWorkflowSkillDependencies } from '../skills-registry.js';
import { parseSkillsSearchOutput } from '../skills-search-parser.js';
import { installSkillForUser } from './skills.js';

const workflowsRoutes = new Hono<{ Variables: Variables }>();
const execFileAsync = promisify(execFile);

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const STAGE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const SKILL_PACKAGE_RE = /^[\w-]+\/[\w.-]+(?:@[\w.-]+)?$/;
const WORKFLOW_TEMPLATE_GENERATE_TIMEOUT_MS = 8 * 60 * 1000;
const WORKFLOW_DEPENDENCY_ON_MISSING_VALUES = ['auto_fix', 'guide_user', 'fallback', 'fail'] as const;
const WORKFLOW_DEPENDENCY_TYPE_VALUES = ['provider', 'skill', 'channel', 'mcp'] as const;
const WORKFLOW_TEMPLATE_PROVIDER_VALUES = ['auto', ...AGENT_PROVIDER_IDS] as const;

const WorkflowStageDependencySchema = z.object({
  type: z.enum(WORKFLOW_DEPENDENCY_TYPE_VALUES),
  ref: z.string().trim().min(1).max(128).transform((value) => value.toLowerCase()),
  required: z.boolean().optional().default(true),
  capability: z.string().trim().max(256).optional(),
  onMissing: z.enum(WORKFLOW_DEPENDENCY_ON_MISSING_VALUES).optional().default('guide_user'),
});

const WorkflowStageSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(TEMPLATE_ID_RE)
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(80),
  defaultProvider: z.enum(AGENT_PROVIDER_IDS),
  strictProvider: z.boolean().optional(),
  fallbackProviders: z.array(z.enum(AGENT_PROVIDER_IDS)).max(3).optional(),
  goal: z.string().trim().max(4000).optional().default(''),
  requiredOutputHints: z.array(z.string().trim().min(1).max(200)).max(24).default([]),
  doneKeywords: z.array(z.string().trim().min(1).max(200)).max(24).default([]),
  skillRefs: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  dependencies: z.array(WorkflowStageDependencySchema).max(64).optional(),
});

const WorkflowTemplateWriteSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(TEMPLATE_ID_RE)
    .transform((value) => value.toLowerCase())
    .optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000).optional().default(''),
  version: z.number().int().min(1).max(999).optional(),
  stages: z.array(WorkflowStageSchema).min(1).max(20),
  recommendedTriggers: z.array(z.string().trim().min(1).max(100)).max(40).default([]),
});

const PublishWorkflowTemplateSchema = z.object({
  chatJid: z.string().trim().min(1).max(200).optional(),
  autoInstallMissingSkills: z.boolean().optional().default(false),
  provider: z.enum(WORKFLOW_TEMPLATE_PROVIDER_VALUES).optional().default('auto'),
  packagesBySkillRef: z.record(z.string(), z.string().trim().max(256)).optional(),
});

const PrecheckWorkflowTemplateSchema = z.object({
  template: WorkflowTemplateWriteSchema.optional(),
});

const GenerateWorkflowTemplateSchema = z.object({
  idea: z.string().trim().min(8).max(4000),
  templateId: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(TEMPLATE_ID_RE)
    .transform((value) => value.toLowerCase())
    .optional(),
  provider: z.enum(WORKFLOW_TEMPLATE_PROVIDER_VALUES).optional().default('auto'),
  chatJid: z.string().trim().min(1).max(200).optional(),
});

const OptimizeWorkflowTemplateSchema = z.object({
  instruction: z.string().trim().min(4).max(4000),
  template: WorkflowTemplateWriteSchema,
  provider: z.enum(WORKFLOW_TEMPLATE_PROVIDER_VALUES).optional().default('auto'),
  chatJid: z.string().trim().min(1).max(200).optional(),
});

const OptimizeWorkflowIdeaSchema = z.object({
  idea: z.string().trim().min(8).max(4000),
  provider: z.enum(WORKFLOW_TEMPLATE_PROVIDER_VALUES).optional().default('auto'),
  chatJid: z.string().trim().min(1).max(200).optional(),
});

function parseScope(value: string): WorkflowTemplateScope | null {
  if (value === 'global' || value === 'user') return value;
  return null;
}

function parseTemplateId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!TEMPLATE_ID_RE.test(normalized)) return null;
  return normalized;
}

function parseStageId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!STAGE_ID_RE.test(normalized)) return null;
  return normalized;
}

function normalizeProvider(value: unknown): AgentProvider {
  return normalizeAgentProvider(value);
}

function normalizeSkillRef(value: string): string {
  return value.trim().toLowerCase();
}

function isSkillPackage(value: string): boolean {
  return SKILL_PACKAGE_RE.test(value.trim());
}

function packageMatchScore(skillRef: string, pkg: string): number {
  const ref = skillRef.trim().toLowerCase();
  const normalized = pkg.trim().toLowerCase();
  if (!ref || !normalized) return 0;
  if (normalized === ref) return 120;
  if (normalized.endsWith(`@${ref}`)) return 100;

  const slashIdx = normalized.indexOf('/');
  if (slashIdx > 0) {
    const repoAndSkill = normalized.slice(slashIdx + 1);
    const [repo] = repoAndSkill.split('@');
    if (repo === ref) return 80;
  }

  if (normalized.includes(ref)) return 40;
  return 0;
}

interface SkillInstallCandidate {
  package: string;
  installs?: string;
  url?: string;
  description?: string;
}

interface SkillInstallResolution {
  optionsBySkillRef: Record<string, string[]>;
  candidatesBySkillRef: Record<string, SkillInstallCandidate[]>;
}

async function resolveSkillInstallOptions(skillRefs: string[]): Promise<SkillInstallResolution> {
  const optionsBySkillRef: Record<string, string[]> = {};
  const candidatesBySkillRef: Record<string, SkillInstallCandidate[]> = {};
  for (const rawRef of skillRefs) {
    const ref = normalizeSkillRef(rawRef);
    if (!ref) continue;
    if (isSkillPackage(ref)) {
      optionsBySkillRef[ref] = [ref];
      candidatesBySkillRef[ref] = [{ package: ref }];
      continue;
    }
    try {
      const { stdout } = await execFileAsync(
        'npx',
        ['-y', 'skills', 'find', ref],
        { timeout: 30_000 },
      );
      const parsed = parseSkillsSearchOutput(stdout);
      const scored = parsed
        .map((item) => ({
          package: item.package.trim(),
          installs: item.installs,
          url: item.url,
          score: packageMatchScore(ref, item.package),
        }))
        .filter((item) => isSkillPackage(item.package))
        .sort((a, b) => b.score - a.score || a.package.localeCompare(b.package));
      const dedupPackages: string[] = [];
      const dedupCandidates: SkillInstallCandidate[] = [];
      for (const item of scored) {
        if (dedupPackages.includes(item.package)) continue;
        dedupPackages.push(item.package);
        dedupCandidates.push({
          package: item.package,
          ...(item.installs ? { installs: item.installs } : {}),
          ...(item.url ? { url: item.url } : {}),
        });
        if (dedupPackages.length >= 6) break;
      }
      optionsBySkillRef[ref] = dedupPackages;
      candidatesBySkillRef[ref] = dedupCandidates;
    } catch (error) {
      if (error && typeof error === 'object' && 'stdout' in error) {
        const stdout = String((error as { stdout?: unknown }).stdout ?? '');
        const parsed = parseSkillsSearchOutput(stdout);
        const dedupCandidates = parsed
          .map((item) => ({
            package: item.package.trim(),
            installs: item.installs,
            url: item.url,
          }))
          .filter((item) => isSkillPackage(item.package))
          .filter((item, idx, arr) => arr.findIndex((target) => target.package === item.package) === idx)
          .slice(0, 6)
          .map((item) => ({
            package: item.package,
            ...(item.installs ? { installs: item.installs } : {}),
            ...(item.url ? { url: item.url } : {}),
          }));
        optionsBySkillRef[ref] = dedupCandidates.map((item) => item.package);
        candidatesBySkillRef[ref] = dedupCandidates;
      } else {
        optionsBySkillRef[ref] = [];
        candidatesBySkillRef[ref] = [];
      }
    }
  }
  return {
    optionsBySkillRef,
    candidatesBySkillRef,
  };
}

function selectPackagesForMissingSkills(options: {
  missingSkillRefs: string[];
  skillInstallOptions: Record<string, string[]>;
  packagesBySkillRef?: Record<string, string>;
}): {
  selectedPackagesBySkillRef: Record<string, string>;
  unresolvedSkillRefs: string[];
  invalidPackageSkillRefs: string[];
} {
  const selectedPackagesBySkillRef: Record<string, string> = {};
  const unresolvedSkillRefs: string[] = [];
  const invalidPackageSkillRefs: string[] = [];
  const inputMap = options.packagesBySkillRef ?? {};

  for (const rawRef of options.missingSkillRefs) {
    const ref = normalizeSkillRef(rawRef);
    if (!ref) continue;
    const candidates = (options.skillInstallOptions[ref] ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const requestedRaw = inputMap[rawRef] ?? inputMap[ref];
    const requested = typeof requestedRaw === 'string' ? requestedRaw.trim() : '';

    if (requested) {
      if (!isSkillPackage(requested)) {
        invalidPackageSkillRefs.push(ref);
        continue;
      }
      if (candidates.length > 0 && !candidates.includes(requested)) {
        unresolvedSkillRefs.push(ref);
        continue;
      }
      selectedPackagesBySkillRef[ref] = requested;
      continue;
    }

    if (candidates.length === 1) {
      selectedPackagesBySkillRef[ref] = candidates[0]!;
      continue;
    }
    unresolvedSkillRefs.push(ref);
  }

  return {
    selectedPackagesBySkillRef,
    unresolvedSkillRefs,
    invalidPackageSkillRefs,
  };
}

function toStringArray(value: unknown, maxItems = 24): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length >= maxItems) break;
  }
  return normalized;
}

type WorkflowStageDependency = NonNullable<WorkflowTemplate['stages'][number]['dependencies']>[number];

function sanitizeStageDependencies(
  dependenciesRaw: unknown,
  toolsRaw: unknown,
): WorkflowStageDependency[] {
  const dependencies: WorkflowStageDependency[] = [];
  const seen = new Set<string>();

  const append = (item: WorkflowStageDependency) => {
    const key = `${item.type}:${item.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    dependencies.push(item);
  };

  for (const raw of Array.isArray(dependenciesRaw) ? dependenciesRaw : []) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const type = typeof item.type === 'string' ? item.type : '';
    if (!WORKFLOW_DEPENDENCY_TYPE_VALUES.includes(type as (typeof WORKFLOW_DEPENDENCY_TYPE_VALUES)[number])) {
      continue;
    }
    const ref = typeof item.ref === 'string' ? item.ref.trim().toLowerCase() : '';
    if (!ref) continue;
    const capability = typeof item.capability === 'string' ? clampText(item.capability, 256) : '';
    const onMissingRaw = typeof item.onMissing === 'string' ? item.onMissing : '';
    const onMissing = WORKFLOW_DEPENDENCY_ON_MISSING_VALUES.includes(onMissingRaw as (typeof WORKFLOW_DEPENDENCY_ON_MISSING_VALUES)[number])
      ? (onMissingRaw as WorkflowStageDependency['onMissing'])
      : 'guide_user';
    append({
      type: type as WorkflowStageDependency['type'],
      ref,
      required: item.required !== false,
      ...(capability ? { capability } : {}),
      onMissing,
    });
  }

  // Backward-friendly mapping for generated `tools` syntax:
  // [{ type: "mcp", name: "stitch", required: true }]
  for (const raw of Array.isArray(toolsRaw) ? toolsRaw : []) {
    if (!raw || typeof raw !== 'object') continue;
    const tool = raw as Record<string, unknown>;
    const type = typeof tool.type === 'string' ? tool.type.trim().toLowerCase() : '';
    if (!WORKFLOW_DEPENDENCY_TYPE_VALUES.includes(type as (typeof WORKFLOW_DEPENDENCY_TYPE_VALUES)[number])) {
      continue;
    }
    const refRaw = typeof tool.ref === 'string'
      ? tool.ref
      : (typeof tool.name === 'string' ? tool.name : '');
    const ref = refRaw.trim().toLowerCase();
    if (!ref) continue;
    append({
      type: type as WorkflowStageDependency['type'],
      ref,
      required: tool.required !== false,
      onMissing: 'guide_user',
    });
  }

  return dependencies;
}

function buildTemplateIdFromText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  if (!normalized) return null;
  return parseTemplateId(normalized);
}

function makeFallbackTemplateId(): string {
  const suffix = Date.now().toString(36).slice(-6);
  const candidate = `workflow-${suffix}`;
  return parseTemplateId(candidate) ?? 'workflow-template';
}

function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed;
}

function summarizeIdea(idea: string, maxLength = 60): string {
  const compact = idea.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const firstClause = compact.split(/[。！？!?;；\n]/)[0]?.trim() || compact;
  return clampText(firstClause, maxLength);
}

function buildAutoTemplateName(templateId: string, idea: string): string {
  const summary = summarizeIdea(idea, 60);
  if (summary) return clampText(summary, 80);
  return clampText(templateId, 80);
}

function buildAutoTemplateDescription(idea: string): string {
  const summary = summarizeIdea(idea, 120);
  if (summary) {
    return clampText(`根据用户想法自动生成：${summary}`, 2000);
  }
  return '由 AI 自动生成的工作流模板。';
}

function sanitizeGeneratedTemplate(
  raw: unknown,
  forcedTemplateId?: string,
  idea = '',
): WorkflowTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;

  const templateId =
    forcedTemplateId
    ?? parseTemplateId(typeof data.id === 'string' ? data.id : '')
    ?? buildTemplateIdFromText(data.name)
    ?? makeFallbackTemplateId();

  const name = typeof data.name === 'string' && data.name.trim()
    ? clampText(data.name, 80)
    : buildAutoTemplateName(templateId, idea);
  const description =
    typeof data.description === 'string' && data.description.trim()
      ? clampText(data.description, 2000)
      : buildAutoTemplateDescription(idea);

  const versionRaw =
    typeof data.version === 'number' && Number.isFinite(data.version)
      ? Math.floor(data.version)
      : 1;
  const version = Math.max(1, Math.min(999, versionRaw));

  const recommendedTriggers = toStringArray(data.recommendedTriggers, 40);
  const stagesRaw = Array.isArray(data.stages) ? data.stages : [];
  if (stagesRaw.length === 0) return null;

  const usedStageIds = new Set<string>();
  const stages: WorkflowTemplate['stages'] = [];
  for (let index = 0; index < Math.min(stagesRaw.length, 20); index += 1) {
    const rawStage = stagesRaw[index];
    if (!rawStage || typeof rawStage !== 'object') continue;
    const stageData = rawStage as Record<string, unknown>;

    const fallbackStageId = `stage-${index + 1}`;
    let stageId =
      parseStageId(typeof stageData.id === 'string' ? stageData.id : '')
      ?? buildTemplateIdFromText(stageData.name)
      ?? fallbackStageId;
    if (usedStageIds.has(stageId)) {
      let dedupeIndex = 2;
      while (usedStageIds.has(`${stageId}-${dedupeIndex}`)) dedupeIndex += 1;
      stageId = `${stageId}-${dedupeIndex}`;
    }
    usedStageIds.add(stageId);

    const defaultProvider = normalizeProvider(stageData.defaultProvider ?? stageData.provider);
    const fallbackProviders = toStringArray(stageData.fallbackProviders, 2)
      .map((value) => normalizeProvider(value))
      .filter((value, pos, array) => array.indexOf(value) === pos);
    const dependencies = sanitizeStageDependencies(stageData.dependencies, stageData.tools);

    stages.push({
      id: stageId,
      name:
        typeof stageData.name === 'string' && stageData.name.trim()
          ? stageData.name.trim()
          : `阶段 ${index + 1}`,
      defaultProvider,
      strictProvider: stageData.strictProvider === true,
      ...(fallbackProviders.length > 0 ? { fallbackProviders } : {}),
      goal: typeof stageData.goal === 'string' ? stageData.goal.trim() : '',
      requiredOutputHints: toStringArray(stageData.requiredOutputHints, 24),
      doneKeywords: toStringArray(stageData.doneKeywords, 24),
      ...(toStringArray(stageData.skillRefs, 64).length > 0
        ? { skillRefs: toStringArray(stageData.skillRefs, 64) }
        : {}),
      ...(dependencies.length > 0 ? { dependencies } : {}),
    });
  }

  if (stages.length === 0) return null;

  return {
    id: templateId,
    name,
    description,
    version,
    stages,
    recommendedTriggers,
  };
}

function formatList(values: string[] | undefined): string {
  return (values ?? []).filter((item) => item.trim().length > 0).join(' | ');
}

function serializeTemplateAsMarkdown(template: WorkflowTemplate): string {
  const lines: string[] = [];
  lines.push(`# Workflow Template: ${template.name}`);
  lines.push('');
  lines.push(`- id: ${template.id}`);
  lines.push(`- name: ${template.name}`);
  lines.push(`- description: ${template.description || ''}`);
  lines.push(`- version: ${template.version || 1}`);
  lines.push(`- recommendedTriggers: ${formatList(template.recommendedTriggers)}`);
  lines.push('');

  for (const stage of template.stages) {
    lines.push(`## Stage: ${stage.id}`);
    lines.push(`- name: ${stage.name}`);
    lines.push(`- provider: ${stage.defaultProvider}`);
    lines.push(`- strictProvider: ${stage.strictProvider === true ? 'true' : 'false'}`);
    lines.push(`- fallbackProviders: ${formatList(stage.fallbackProviders)}`);
    lines.push(`- goal: ${stage.goal || ''}`);
    lines.push(`- requiredOutputHints: ${formatList(stage.requiredOutputHints)}`);
    lines.push(`- doneKeywords: ${formatList(stage.doneKeywords)}`);
    lines.push(`- skillRefs: ${formatList(stage.skillRefs)}`);
    lines.push(`- dependencies: ${JSON.stringify(stage.dependencies ?? [])}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function signalAgentRunnerClose(groupFolder: string, agentId: string): void {
  try {
    const inputDir = path.join(DATA_DIR, 'ipc', groupFolder, 'agents', agentId, 'input');
    fs.mkdirSync(inputDir, { recursive: true });
    const sentinelPath = path.join(inputDir, '_close');
    try {
      fs.unlinkSync(sentinelPath);
    } catch {
      // Ignore stale/missing sentinel file.
    }
    fs.writeFileSync(sentinelPath, '');
  } catch (err) {
    logger.warn(
      { groupFolder, agentId, err },
      'Failed to write close sentinel for workflow template generation',
    );
  }
}

function buildWorkflowTemplateGeneratePrompt(options: {
  idea: string;
  templateId?: string;
}): string {
  const { idea, templateId } = options;
  return [
    '你是 Workflow 模板生成助手。',
    '请根据“用户想法”生成一个可执行的 workflow 模板 JSON。',
    '必须包含字段：id、name、description、stages、recommendedTriggers。',
    '约束：provider 只能是 claude、codex 或 gemini，阶段数量 2-8。',
    'name 需简洁明确（1-20字优先），description 需说明适用场景和目标。',
    '每个阶段建议包含：goal、requiredOutputHints、doneKeywords。',
    '若阶段依赖外部能力（如 skill/mcp/channel/provider），请在 dependencies 中声明：',
    '[{ "type":"skill|mcp|channel|provider", "ref":"xxx", "required":true, "onMissing":"guide_user|auto_fix|fallback|fail" }]',
    templateId ? `模板 id 必须固定为：${templateId}` : '请生成一个合法模板 id（小写字母/数字/-/_）。',
    '请不要调用任何工具，不要解释，不要输出额外文本。',
    '只输出以下标签包裹的 JSON：',
    '<workflow_template_json>',
    '{...}',
    '</workflow_template_json>',
    '',
    `用户想法：${idea}`,
  ].join('\n');
}

function buildWorkflowTemplateOptimizePrompt(options: {
  instruction: string;
  templateId: string;
  templateJson: string;
}): string {
  const { instruction, templateId, templateJson } = options;
  return [
    '你是 Workflow 模板优化助手。',
    '请严格基于“当前模板 JSON”和“优化目标”输出完整的 workflow 模板 JSON。',
    `硬约束：template.id 必须保持为 ${templateId}，provider 只允许 claude、codex 或 gemini。`,
    '请尽量做最小必要改动，不要删除无关阶段。',
    '若阶段依赖外部能力（如 skill/mcp/channel/provider），请在 dependencies 中声明：',
    '[{ "type":"skill|mcp|channel|provider", "ref":"xxx", "required":true, "onMissing":"guide_user|auto_fix|fallback|fail" }]',
    '请不要调用任何工具，不要解释，不要输出额外文本。',
    '只输出以下标签包裹的 JSON：',
    '<workflow_template_json>',
    '{...}',
    '</workflow_template_json>',
    '',
    `优化目标：${instruction}`,
    '',
    '当前模板 JSON：',
    '```json',
    templateJson,
    '```',
  ].join('\n');
}

function buildWorkflowIdeaOptimizePrompt(options: {
  idea: string;
}): string {
  const { idea } = options;
  return [
    '你是 Workflow 自动化需求优化助手。',
    '请将用户输入的自动化需求改写为更清晰、可执行、便于 AI 生成模板的描述。',
    '输出要求：',
    '1) 仅输出纯文本，不要 Markdown，不要代码块，不要解释。',
    '2) 保留用户原意，补充关键目标、阶段建议、依赖约束、验收标准。',
    '3) 内容长度控制在 120-400 字。',
    '',
    `用户原始需求：${idea}`,
  ].join('\n');
}

function sanitizeOptimizedIdea(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withoutFence = trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return withoutFence.replace(/^优化后(?:的)?需求[：:]\s*/i, '').trim();
}

interface WorkflowTemplateAiInvocationOptions {
  user: AuthUser;
  provider: AgentProvider;
  prompt: string;
  chatJid?: string;
  agentIdPrefix: string;
  agentName: string;
  action: 'generation' | 'optimization';
}

type WorkflowTemplateAiInvocationResult =
  | {
    ok: true;
    rawModelOutput: string;
  }
  | {
    ok: false;
    status: 400 | 403 | 404 | 500 | 502;
    body: Record<string, unknown>;
  };

async function invokeWorkflowTemplateAi(
  options: WorkflowTemplateAiInvocationOptions,
): Promise<WorkflowTemplateAiInvocationResult> {
  const {
    user,
    provider,
    prompt,
    chatJid,
    agentIdPrefix,
    agentName,
    action,
  } = options;

  let targetJid: string | null = null;
  let targetGroup: (ReturnType<typeof getRegisteredGroup> & { jid: string }) | null = null;
  if (chatJid) {
    const group = getRegisteredGroup(chatJid);
    if (!group) return { ok: false, status: 404, body: { error: 'Group not found' } };
    if (!canAccessGroup({ id: user.id, role: user.role }, group)) {
      return { ok: false, status: 404, body: { error: 'Group not found' } };
    }
    targetJid = chatJid;
    targetGroup = group;
  } else {
    const homeGroup = getUserHomeGroup(user.id);
    if (!homeGroup) {
      return { ok: false, status: 400, body: { error: 'No home group found for current user' } };
    }
    targetJid = homeGroup.jid;
    targetGroup = homeGroup;
  }

  if (!targetJid || !targetGroup) {
    return { ok: false, status: 400, body: { error: 'No runnable group available' } };
  }
  if (isHostExecutionGroup(targetGroup) && !hasHostExecutionPermission(user)) {
    return {
      ok: false,
      status: 403,
      body: { error: 'Insufficient permissions for host execution mode' },
    };
  }

  const isHome = !!targetGroup.is_home;
  const isAdminHome = isHome && targetGroup.folder === 'main';
  // AI template flows must avoid sharing IPC/session directory with main chat process.
  const agentId = `${agentIdPrefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  const effectiveGroup = {
    ...targetGroup,
    containerConfig: {
      ...(targetGroup.containerConfig ?? {}),
      timeout: Math.min(
        targetGroup.containerConfig?.timeout ?? WORKFLOW_TEMPLATE_GENERATE_TIMEOUT_MS,
        WORKFLOW_TEMPLATE_GENERATE_TIMEOUT_MS,
      ),
    },
  };
  let rawModelOutput = '';
  let closeSentinelWritten = false;
  const maybeCloseAgentRunner = () => {
    if (closeSentinelWritten) return;
    closeSentinelWritten = true;
    signalAgentRunnerClose(effectiveGroup.folder, agentId);
  };
  const onOutput = async (output: {
    status: 'success' | 'error' | 'stream';
    result: string | null;
  }) => {
    if (output.status === 'stream') return;
    const text = typeof output.result === 'string' ? output.result.trim() : '';
    if (text) rawModelOutput = text;
    if (output.status === 'success' && output.result === null) {
      maybeCloseAgentRunner();
    }
  };

  logger.info(
    {
      userId: user.id,
      provider,
      chatJid: targetJid,
      groupFolder: effectiveGroup.folder,
      executionMode: effectiveGroup.executionMode || 'container',
      agentId,
      timeoutMs: effectiveGroup.containerConfig?.timeout ?? WORKFLOW_TEMPLATE_GENERATE_TIMEOUT_MS,
      action,
    },
    'Workflow template AI task started',
  );
  const startedAt = Date.now();

  const result =
    (effectiveGroup.executionMode || 'container') === 'host'
      ? await runHostAgent(
        effectiveGroup,
        {
          prompt,
          groupFolder: effectiveGroup.folder,
          chatJid: targetJid,
          agentRuntimeOverride: provider,
          isMain: isAdminHome,
          isHome,
          isAdminHome,
          agentId,
          agentName,
        },
        () => {},
        onOutput,
      )
      : await runContainerAgent(
        effectiveGroup,
        {
          prompt,
          groupFolder: effectiveGroup.folder,
          chatJid: targetJid,
          agentRuntimeOverride: provider,
          isMain: isAdminHome,
          isHome,
          isAdminHome,
          agentId,
          agentName,
        },
        () => {},
        onOutput,
      );

  logger.info(
    {
      userId: user.id,
      provider,
      chatJid: targetJid,
      durationMs: Date.now() - startedAt,
      status: result.status,
      hasResult: !!result.result,
      hasRawOutput: rawModelOutput.trim().length > 0,
      action,
    },
    'Workflow template AI task finished',
  );
  maybeCloseAgentRunner();

  if (!rawModelOutput && typeof result.result === 'string') {
    rawModelOutput = result.result.trim();
  }
  if (result.status === 'error' && !rawModelOutput) {
    return {
      ok: false,
      status: 500,
      body: { error: `AI ${action} failed: ${result.error || 'unknown error'}` },
    };
  }
  if (!rawModelOutput) {
    return {
      ok: false,
      status: 502,
      body: { error: `AI ${action} returned empty content` },
    };
  }
  return {
    ok: true,
    rawModelOutput,
  };
}

function persistTemplateRegistry(): void {
  setRouterState('workflow_template_registry', serializeWorkflowTemplateRegistry());
}

function canEditRecord(record: WorkflowTemplateRecord, user: AuthUser): boolean {
  if (record.isBuiltin) return false;
  if (record.scope === 'global') return hasPermission(user, 'manage_system_config');
  return record.ownerUserId === user.id;
}

function toPublicRecord(record: WorkflowTemplateRecord, user: AuthUser) {
  const editable = canEditRecord(record, user);
  return {
    ...record,
    editable,
    publishable: editable && record.lifecycle === 'draft',
    archivable: editable && (record.lifecycle === 'draft' || record.lifecycle === 'published'),
  };
}

workflowsRoutes.get('/templates', authMiddleware, (c) => {
  const user = c.get('user') as AuthUser;
  const view = c.req.query('view') === 'manage' ? 'manage' : 'visible';
  const queryScope = c.req.query('scope');
  const queryLifecycle = c.req.query('lifecycle');

  if (view === 'visible') {
    const records = listWorkflowTemplateRecords({
      ownerUserId: user.id,
      visibleOnly: true,
    });
    return c.json({
      templates: records.map((record) => toPublicRecord(record, user)),
    });
  }

  const scope = queryScope === 'global' || queryScope === 'user' || queryScope === 'all'
    ? queryScope
    : 'all';
  const lifecycle = queryLifecycle === 'draft'
    || queryLifecycle === 'published'
    || queryLifecycle === 'archived'
    || queryLifecycle === 'all'
    ? queryLifecycle
    : 'all';

  const canManageSystem = hasPermission(user, 'manage_system_config');
  if (!canManageSystem && scope === 'global') {
    return c.json({ error: 'Forbidden: manage_system_config required for global scope' }, 403);
  }

  const templates: WorkflowTemplateRecord[] = [];

  if (scope === 'all' || scope === 'user') {
    const userRecords = listWorkflowTemplateRecords({
      scope: 'user',
      ownerUserId: user.id,
      lifecycle,
      includeBuiltin: false,
    });
    templates.push(...userRecords);
  }

  if (scope === 'all' || scope === 'global') {
    if (canManageSystem) {
      const globalRecords = listWorkflowTemplateRecords({
        scope: 'global',
        lifecycle,
        includeBuiltin: true,
      });
      templates.push(...globalRecords);
    } else if (lifecycle === 'published' || lifecycle === 'all') {
      const visibleGlobal = listWorkflowTemplateRecords({
        ownerUserId: user.id,
        visibleOnly: true,
      }).filter((record) => record.scope === 'global');
      templates.push(...visibleGlobal);
    }
  }

  templates.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    const ownerA = a.ownerUserId ?? '';
    const ownerB = b.ownerUserId ?? '';
    if (ownerA !== ownerB) return ownerA.localeCompare(ownerB);
    if (a.template.id !== b.template.id) return a.template.id.localeCompare(b.template.id);
    return a.lifecycle.localeCompare(b.lifecycle);
  });

  return c.json({
    templates: templates.map((record) => toPublicRecord(record, user)),
  });
});

workflowsRoutes.post('/templates/generate', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => ({}));
  const validation = GenerateWorkflowTemplateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const payload = validation.data;
  const config = getRuntimeProviderConfig();
  const provider: AgentProvider =
    payload.provider === 'auto'
      ? config.agentRuntime
      : payload.provider;

  if (!isAgentProviderConfigured(provider, config)) {
    return c.json(
      {
        error: `Provider ${provider} is not configured`,
        details: { provider },
      },
      400,
    );
  }

  const prompt = buildWorkflowTemplateGeneratePrompt({
    idea: payload.idea,
    ...(payload.templateId ? { templateId: payload.templateId } : {}),
  });
  const aiInvoke = await invokeWorkflowTemplateAi({
    user,
    provider,
    prompt,
    chatJid: payload.chatJid,
    agentIdPrefix: 'wf-template-gen',
    agentName: 'workflow-template-generator',
    action: 'generation',
  });
  if (!aiInvoke.ok) {
    return c.json(aiInvoke.body, aiInvoke.status);
  }

  let candidate: unknown;
  try {
    candidate = extractWorkflowTemplateJsonCandidate(aiInvoke.rawModelOutput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to parse AI output: ${message}` }, 502);
  }

  const template = sanitizeGeneratedTemplate(candidate, payload.templateId, payload.idea);
  if (!template) {
    return c.json(
      { error: 'Failed to build valid workflow template from AI output' },
      502,
    );
  }

  return c.json({
    provider,
    templateId: template.id,
    template,
    markdown: serializeTemplateAsMarkdown(template),
  });
});

workflowsRoutes.post('/templates/idea-optimize', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => ({}));
  const validation = OptimizeWorkflowIdeaSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const payload = validation.data;
  const config = getRuntimeProviderConfig();
  const provider: AgentProvider =
    payload.provider === 'auto'
      ? config.agentRuntime
      : payload.provider;

  if (!isAgentProviderConfigured(provider, config)) {
    return c.json(
      {
        error: `Provider ${provider} is not configured`,
        details: { provider },
      },
      400,
    );
  }

  const prompt = buildWorkflowIdeaOptimizePrompt({
    idea: payload.idea,
  });
  const aiInvoke = await invokeWorkflowTemplateAi({
    user,
    provider,
    prompt,
    chatJid: payload.chatJid,
    agentIdPrefix: 'wf-idea-opt',
    agentName: 'workflow-idea-optimizer',
    action: 'optimization',
  });
  if (!aiInvoke.ok) {
    return c.json(aiInvoke.body, aiInvoke.status);
  }

  const optimizedIdea = sanitizeOptimizedIdea(aiInvoke.rawModelOutput);
  if (!optimizedIdea) {
    return c.json({ error: 'AI optimized idea is empty' }, 502);
  }

  return c.json({
    provider,
    optimizedIdea,
  });
});

workflowsRoutes.post('/templates/:scope/:templateId/optimize', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const scope = parseScope(c.req.param('scope'));
  if (!scope) return c.json({ error: 'Invalid scope' }, 400);
  const templateId = parseTemplateId(c.req.param('templateId'));
  if (!templateId) return c.json({ error: 'Invalid template id' }, 400);

  if (scope === 'global' && !hasPermission(user, 'manage_system_config')) {
    return c.json({ error: 'Forbidden: manage_system_config required for global scope' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const validation = OptimizeWorkflowTemplateSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const payload = validation.data;
  if (payload.template.id && payload.template.id !== templateId) {
    return c.json({ error: 'Template id in path and body must match' }, 400);
  }
  const sourceTemplate: WorkflowTemplate = {
    id: templateId,
    name: payload.template.name,
    description: payload.template.description,
    version: payload.template.version ?? 1,
    stages: payload.template.stages,
    recommendedTriggers: payload.template.recommendedTriggers,
  };

  const config = getRuntimeProviderConfig();
  const provider: AgentProvider =
    payload.provider === 'auto'
      ? config.agentRuntime
      : payload.provider;
  if (!isAgentProviderConfigured(provider, config)) {
    return c.json(
      {
        error: `Provider ${provider} is not configured`,
        details: { provider },
      },
      400,
    );
  }

  const prompt = buildWorkflowTemplateOptimizePrompt({
    instruction: payload.instruction,
    templateId,
    templateJson: JSON.stringify(sourceTemplate, null, 2),
  });
  const aiInvoke = await invokeWorkflowTemplateAi({
    user,
    provider,
    prompt,
    chatJid: payload.chatJid,
    agentIdPrefix: 'wf-template-opt',
    agentName: 'workflow-template-optimizer',
    action: 'optimization',
  });
  if (!aiInvoke.ok) {
    return c.json(aiInvoke.body, aiInvoke.status);
  }

  let candidate: unknown;
  try {
    candidate = extractWorkflowTemplateJsonCandidate(aiInvoke.rawModelOutput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Failed to parse AI output: ${message}` }, 502);
  }

  const template = sanitizeGeneratedTemplate(candidate, templateId, payload.instruction);
  if (!template) {
    return c.json(
      { error: 'Failed to build valid workflow template from AI output' },
      502,
    );
  }

  return c.json({
    provider,
    templateId: template.id,
    template,
    markdown: serializeTemplateAsMarkdown(template),
  });
});

workflowsRoutes.put('/templates/:scope/:templateId', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const scope = parseScope(c.req.param('scope'));
  if (!scope) return c.json({ error: 'Invalid scope' }, 400);
  const templateId = parseTemplateId(c.req.param('templateId'));
  if (!templateId) return c.json({ error: 'Invalid template id' }, 400);

  if (scope === 'global' && !hasPermission(user, 'manage_system_config')) {
    return c.json({ error: 'Forbidden: manage_system_config required for global scope' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const validation = WorkflowTemplateWriteSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const payload = validation.data;
  if (payload.id && payload.id !== templateId) {
    return c.json({ error: 'Template id in path and body must match' }, 400);
  }

  const template: WorkflowTemplate = {
    id: templateId,
    name: payload.name,
    description: payload.description,
    version: payload.version ?? 1,
    stages: payload.stages,
    recommendedTriggers: payload.recommendedTriggers,
  };

  try {
    const record = upsertWorkflowTemplateDraft({
      scope,
      ownerUserId: scope === 'user' ? user.id : null,
      template,
    });
    persistTemplateRegistry();
    return c.json({ template: toPublicRecord(record, user) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid workflow template payload';
    return c.json({ error: message }, 400);
  }
});

workflowsRoutes.post('/templates/:scope/:templateId/precheck', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const scope = parseScope(c.req.param('scope'));
  if (!scope) return c.json({ error: 'Invalid scope' }, 400);
  const templateId = parseTemplateId(c.req.param('templateId'));
  if (!templateId) return c.json({ error: 'Invalid template id' }, 400);

  if (scope === 'global' && !hasPermission(user, 'manage_system_config')) {
    return c.json({ error: 'Forbidden: manage_system_config required for global scope' }, 403);
  }

  const ownerUserId = scope === 'user' ? user.id : null;
  const body = await c.req.json().catch(() => ({}));
  const bodyValidation = PrecheckWorkflowTemplateSchema.safeParse(body);
  if (!bodyValidation.success) {
    return c.json(
      { error: 'Invalid request body', details: bodyValidation.error.format() },
      400,
    );
  }

  let templateForCheck: WorkflowTemplate;
  const payloadTemplate = bodyValidation.data.template;
  if (payloadTemplate) {
    if (payloadTemplate.id && payloadTemplate.id !== templateId) {
      return c.json({ error: 'Template id in path and body must match' }, 400);
    }
    templateForCheck = {
      id: templateId,
      name: payloadTemplate.name,
      description: payloadTemplate.description,
      version: payloadTemplate.version ?? 1,
      stages: payloadTemplate.stages,
      recommendedTriggers: payloadTemplate.recommendedTriggers,
    };
  } else {
    const draft = getWorkflowTemplateRecordByRef({
      scope,
      ownerUserId,
      templateId,
      lifecycle: 'draft',
    });
    if (!draft) {
      return c.json({ error: 'Draft template not found' }, 404);
    }
    templateForCheck = draft.template;
  }

  const dependencyCheck = checkWorkflowSkillDependencies(
    collectWorkflowTemplateSkillRefs(templateForCheck),
    {
      scope,
      ownerUserId,
    },
  );
  const installResolution = await resolveSkillInstallOptions(dependencyCheck.missingSkillRefs);

  return c.json({
    templateId,
    hasBlockingIssues:
      dependencyCheck.invalidSkillRefs.length > 0
      || dependencyCheck.missingSkillRefs.length > 0,
    dependencyCheck: {
      invalidSkillRefs: dependencyCheck.invalidSkillRefs,
      missingSkillRefs: dependencyCheck.missingSkillRefs,
      availableSkillRefs: dependencyCheck.availableSkillRefs,
      skillInstallOptions: installResolution.optionsBySkillRef,
      skillInstallCandidates: installResolution.candidatesBySkillRef,
    },
  });
});

workflowsRoutes.post('/templates/:scope/:templateId/publish', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const scope = parseScope(c.req.param('scope'));
  if (!scope) return c.json({ error: 'Invalid scope' }, 400);
  const templateId = parseTemplateId(c.req.param('templateId'));
  if (!templateId) return c.json({ error: 'Invalid template id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const bodyValidation = PublishWorkflowTemplateSchema.safeParse(body);
  if (!bodyValidation.success) {
    return c.json(
      { error: 'Invalid request body', details: bodyValidation.error.format() },
      400,
    );
  }
  const {
    chatJid,
    autoInstallMissingSkills,
    provider: installProviderInput,
    packagesBySkillRef,
  } = bodyValidation.data;

  if (scope === 'global' && !hasPermission(user, 'manage_system_config')) {
    return c.json({ error: 'Forbidden: manage_system_config required for global scope' }, 403);
  }

  const ownerUserId = scope === 'user' ? user.id : null;
  const draft = getWorkflowTemplateRecordByRef({
    scope,
    ownerUserId,
    templateId,
    lifecycle: 'draft',
  });
  if (!draft) {
    return c.json({ error: 'Draft template not found' }, 404);
  }

  const collectDependencyCheck = () => checkWorkflowSkillDependencies(
    collectWorkflowTemplateSkillRefs(draft.template),
    {
      scope,
      ownerUserId,
    },
  );
  let skillDependencyCheck = collectDependencyCheck();
  let autoInstallResult: {
    selectedPackagesBySkillRef: Record<string, string>;
    installedSkills: Array<{ skillRef: string; pkg: string }>;
    failedSkills: Array<{ skillRef: string; pkg: string; reason: string }>;
  } | null = null;

  if (
    skillDependencyCheck.invalidSkillRefs.length > 0
    || skillDependencyCheck.missingSkillRefs.length > 0
  ) {
    const installResolution = await resolveSkillInstallOptions(skillDependencyCheck.missingSkillRefs);
    const skillInstallOptions = installResolution.optionsBySkillRef;
    const skillInstallCandidates = installResolution.candidatesBySkillRef;
    if (autoInstallMissingSkills) {
      if (scope !== 'user' || ownerUserId !== user.id) {
        return c.json({
          error: 'Automatic skill installation is only supported for user scope templates',
          details: {
            invalidSkillRefs: skillDependencyCheck.invalidSkillRefs,
            missingSkillRefs: skillDependencyCheck.missingSkillRefs,
            availableSkillRefs: skillDependencyCheck.availableSkillRefs,
            skillInstallOptions,
            skillInstallCandidates,
          },
        }, 400);
      }

      const selected = selectPackagesForMissingSkills({
        missingSkillRefs: skillDependencyCheck.missingSkillRefs,
        skillInstallOptions,
        packagesBySkillRef,
      });
      if (selected.invalidPackageSkillRefs.length > 0 || selected.unresolvedSkillRefs.length > 0) {
        return c.json({
          error: 'Workflow skill dependencies are not satisfied',
          details: {
            invalidSkillRefs: skillDependencyCheck.invalidSkillRefs,
            missingSkillRefs: skillDependencyCheck.missingSkillRefs,
            availableSkillRefs: skillDependencyCheck.availableSkillRefs,
            skillInstallOptions,
            skillInstallCandidates,
            unresolvedSkillRefs: selected.unresolvedSkillRefs,
            invalidPackageSkillRefs: selected.invalidPackageSkillRefs,
            selectedPackagesBySkillRef: selected.selectedPackagesBySkillRef,
          },
        }, 400);
      }

      const installProvider = installProviderInput === 'auto'
        ? normalizeAgentProvider(getRuntimeProviderConfig().agentRuntime)
        : normalizeAgentProvider(installProviderInput);
      const installedSkills: Array<{ skillRef: string; pkg: string }> = [];
      const failedSkills: Array<{ skillRef: string; pkg: string; reason: string }> = [];
      for (const [skillRef, pkg] of Object.entries(selected.selectedPackagesBySkillRef)) {
        const installResult = await installSkillForUser(user.id, pkg, installProvider);
        if (installResult.success) {
          installedSkills.push({ skillRef, pkg });
        } else {
          failedSkills.push({
            skillRef,
            pkg,
            reason: installResult.error || 'Unknown install error',
          });
        }
      }

      autoInstallResult = {
        selectedPackagesBySkillRef: selected.selectedPackagesBySkillRef,
        installedSkills,
        failedSkills,
      };
      skillDependencyCheck = collectDependencyCheck();
      if (
        skillDependencyCheck.invalidSkillRefs.length > 0
        || skillDependencyCheck.missingSkillRefs.length > 0
        || failedSkills.length > 0
      ) {
        return c.json({
          error: 'Workflow skill dependencies are not satisfied',
          details: {
            invalidSkillRefs: skillDependencyCheck.invalidSkillRefs,
            missingSkillRefs: skillDependencyCheck.missingSkillRefs,
            availableSkillRefs: skillDependencyCheck.availableSkillRefs,
            skillInstallOptions,
            skillInstallCandidates,
            selectedPackagesBySkillRef: selected.selectedPackagesBySkillRef,
            installedSkills,
            failedSkills,
          },
        }, 400);
      }
    } else {
      return c.json({
        error: 'Workflow skill dependencies are not satisfied',
        details: {
          invalidSkillRefs: skillDependencyCheck.invalidSkillRefs,
          missingSkillRefs: skillDependencyCheck.missingSkillRefs,
          availableSkillRefs: skillDependencyCheck.availableSkillRefs,
          skillInstallOptions,
          skillInstallCandidates,
        },
      }, 400);
    }
  }

  const record = publishWorkflowTemplateDraft({
    scope,
    ownerUserId,
    templateId,
  });
  if (!record) return c.json({ error: 'Draft template not found' }, 404);

  persistTemplateRegistry();

  if (chatJid) {
    const group = getRegisteredGroup(chatJid);
    if (group && canAccessGroup({ id: user.id, role: user.role }, group)) {
      const payload = {
        templateId,
        scope,
        status: 'published' as const,
        summary: `模板 ${templateId} 已发布`,
        version: record.template.version,
        publishable: false,
      };
      const messageId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const content = `workflow_template_edit:${JSON.stringify(payload)}`;
      ensureChatExists(chatJid);
      storeMessageDirect(
        messageId,
        chatJid,
        '__system__',
        'system',
        content,
        timestamp,
        true,
      );
      broadcastNewMessage(chatJid, {
        id: messageId,
        chat_jid: chatJid,
        sender: '__system__',
        sender_name: 'system',
        content,
        timestamp,
        is_from_me: true,
      });
    }
  }

  return c.json({
    template: toPublicRecord(record, user),
    ...(autoInstallResult
      ? {
        autoInstallResult: {
          selectedPackagesBySkillRef: autoInstallResult.selectedPackagesBySkillRef,
          installedSkills: autoInstallResult.installedSkills,
          failedSkills: autoInstallResult.failedSkills,
        },
      }
      : {}),
  });
});

workflowsRoutes.post('/templates/:scope/:templateId/archive', authMiddleware, (c) => {
  const user = c.get('user') as AuthUser;
  const scope = parseScope(c.req.param('scope'));
  if (!scope) return c.json({ error: 'Invalid scope' }, 400);
  const templateId = parseTemplateId(c.req.param('templateId'));
  if (!templateId) return c.json({ error: 'Invalid template id' }, 400);

  if (scope === 'global' && !hasPermission(user, 'manage_system_config')) {
    return c.json({ error: 'Forbidden: manage_system_config required for global scope' }, 403);
  }

  const record = archiveWorkflowTemplate({
    scope,
    ownerUserId: scope === 'user' ? user.id : null,
    templateId,
  });
  if (!record) {
    return c.json({ error: 'Template not found for archive' }, 404);
  }

  persistTemplateRegistry();
  return c.json({ template: toPublicRecord(record, user) });
});

export default workflowsRoutes;
