import type {
  WorkflowStageDef,
  WorkflowStageDependencyDef,
  WorkflowTemplate,
} from '../components/settings/types';

export type WorkflowTemplateEditorMode = 'json' | 'markdown';

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const STAGE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const DEPENDENCY_TYPES = new Set(['provider', 'skill', 'channel', 'mcp']);
const DEPENDENCY_ON_MISSING = new Set(['auto_fix', 'guide_user', 'fallback', 'fail']);

interface StageDraft {
  id: string;
  fields: Record<string, string>;
}

function normalizeTemplateId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!TEMPLATE_ID_RE.test(normalized)) return null;
  return normalized;
}

function normalizeStageId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!STAGE_ID_RE.test(normalized)) return null;
  return normalized;
}

function splitList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[|,，、]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBool(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function parseProvider(value: string): 'claude' | 'codex' | 'gemini' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'codex') return 'codex';
  if (normalized === 'gemini') return 'gemini';
  return 'claude';
}

function formatList(values: string[] | undefined): string {
  return (values ?? []).filter((item) => item.trim().length > 0).join(' | ');
}

function parseDependenciesField(value: string): WorkflowStageDependencyDef[] {
  const raw = value.trim();
  if (!raw) return [];
  const dependencies: WorkflowStageDependencyDef[] = [];
  const seen = new Set<string>();

  const append = (dependency: WorkflowStageDependencyDef) => {
    const key = `${dependency.type}:${dependency.ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    dependencies.push(dependency);
  };

  const parseObjectArray = (items: unknown[]) => {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';
      const ref = typeof record.ref === 'string' ? record.ref.trim().toLowerCase() : '';
      if (!DEPENDENCY_TYPES.has(type) || !ref) continue;
      const capability = typeof record.capability === 'string' ? record.capability.trim() : '';
      const onMissingRaw = typeof record.onMissing === 'string'
        ? record.onMissing.trim().toLowerCase()
        : '';
      const onMissing = DEPENDENCY_ON_MISSING.has(onMissingRaw) ? onMissingRaw : 'guide_user';
      append({
        type: type as WorkflowStageDependencyDef['type'],
        ref,
        required: record.required !== false,
        ...(capability ? { capability } : {}),
        onMissing: onMissing as WorkflowStageDependencyDef['onMissing'],
      });
    }
  };

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        parseObjectArray(parsed);
        return dependencies;
      }
    } catch {
      return [];
    }
    return [];
  }

  for (const item of splitList(raw)) {
    const [typeRaw, refRaw, onMissingRaw] = item.split(':');
    const type = (typeRaw || '').trim().toLowerCase();
    const ref = (refRaw || '').trim().toLowerCase();
    if (!DEPENDENCY_TYPES.has(type) || !ref) continue;
    const onMissing = DEPENDENCY_ON_MISSING.has((onMissingRaw || '').trim().toLowerCase())
      ? (onMissingRaw || '').trim().toLowerCase()
      : 'guide_user';
    append({
      type: type as WorkflowStageDependencyDef['type'],
      ref,
      required: true,
      onMissing: onMissing as WorkflowStageDependencyDef['onMissing'],
    });
  }

  return dependencies;
}

function parseStageDraft(stage: StageDraft): WorkflowStageDef {
  const provider = parseProvider(stage.fields.provider ?? stage.fields.defaultProvider ?? '');
  const fallbackProviders = splitList(stage.fields.fallbackProviders)
    .map((item) => parseProvider(item))
    .filter((item, index, array) => array.indexOf(item) === index);
  const requiredOutputHints = splitList(stage.fields.requiredOutputHints);
  const doneKeywords = splitList(stage.fields.doneKeywords);
  const skillRefs = splitList(stage.fields.skillRefs);
  const dependencies = parseDependenciesField(stage.fields.dependencies ?? '');

  return {
    id: stage.id,
    name: stage.fields.name?.trim() || stage.id,
    defaultProvider: provider,
    strictProvider: parseBool(stage.fields.strictProvider ?? ''),
    ...(fallbackProviders.length > 0 ? { fallbackProviders } : {}),
    goal: stage.fields.goal?.trim() ?? '',
    requiredOutputHints,
    doneKeywords,
    ...(skillRefs.length > 0 ? { skillRefs } : {}),
    ...(dependencies.length > 0 ? { dependencies } : {}),
  };
}

export function serializeWorkflowTemplateMarkdown(template: WorkflowTemplate): string {
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

export function parseWorkflowTemplateMarkdown(
  markdown: string,
  templateIdFallback?: string | null,
): { template: WorkflowTemplate } {
  const text = typeof markdown === 'string' ? markdown : '';
  const lines = text.split(/\r?\n/);
  const metaFields: Record<string, string> = {};
  const stages: StageDraft[] = [];
  let currentStage: StageDraft | null = null;

  const pushStage = () => {
    if (!currentStage) return;
    stages.push(currentStage);
    currentStage = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('# ')) continue;

    const stageMatch = /^##\s*Stage:\s*(.+)$/i.exec(line);
    if (stageMatch) {
      pushStage();
      const stageId = normalizeStageId(stageMatch[1]);
      if (!stageId) {
        throw new Error(`阶段 ID 不合法：${stageMatch[1]}`);
      }
      currentStage = { id: stageId, fields: {} };
      continue;
    }

    const kvMatch = /^-\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kvMatch) continue;
    const key = kvMatch[1].trim();
    const value = kvMatch[2].trim();
    if (currentStage) {
      currentStage.fields[key] = value;
    } else {
      metaFields[key] = value;
    }
  }
  pushStage();

  if (stages.length === 0) {
    throw new Error('模板至少需要一个阶段（## Stage: ...）');
  }

  const templateId = normalizeTemplateId(metaFields.id) ?? normalizeTemplateId(templateIdFallback);
  if (!templateId) {
    throw new Error('模板 ID 不合法（请在 markdown 里填写 `- id:` 或输入合法模板 ID）');
  }

  const versionRaw = Number.parseInt(metaFields.version || '1', 10);
  const version = Number.isFinite(versionRaw) && versionRaw > 0 ? versionRaw : 1;

  return {
    template: {
      id: templateId,
      name: (metaFields.name || templateId).trim(),
      description: (metaFields.description || '').trim(),
      version,
      recommendedTriggers: splitList(metaFields.recommendedTriggers || ''),
      stages: stages.map((stage) => parseStageDraft(stage)),
    },
  };
}

export function parseWorkflowTemplateEditorInput(options: {
  mode: WorkflowTemplateEditorMode;
  text: string;
  templateIdFallback?: string | null;
}): { templateId: string; payload: WorkflowTemplate } {
  const { mode, text, templateIdFallback } = options;
  if (mode === 'markdown') {
    const parsed = parseWorkflowTemplateMarkdown(text, templateIdFallback);
    return {
      templateId: parsed.template.id,
      payload: parsed.template,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('模板 JSON 格式错误，请先修正');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('模板 JSON 必须是对象');
  }

  const payload = parsed as Partial<WorkflowTemplate>;
  const payloadId = typeof payload.id === 'string' ? normalizeTemplateId(payload.id) : null;
  const normalizedInputId = normalizeTemplateId(templateIdFallback);
  const templateId = payloadId ?? normalizedInputId;
  if (!templateId) {
    throw new Error('请先填写合法的模板 ID');
  }

  return {
    templateId,
    payload: {
      id: templateId,
      name: typeof payload.name === 'string' ? payload.name : templateId,
      description: typeof payload.description === 'string' ? payload.description : '',
      version: typeof payload.version === 'number' ? payload.version : 1,
      stages: Array.isArray(payload.stages) ? payload.stages : [],
      recommendedTriggers: Array.isArray(payload.recommendedTriggers)
        ? payload.recommendedTriggers
        : [],
    },
  };
}

export function serializeWorkflowTemplateForEditor(
  template: WorkflowTemplate,
  mode: WorkflowTemplateEditorMode,
): string {
  if (mode === 'json') {
    return JSON.stringify(template, null, 2);
  }
  return serializeWorkflowTemplateMarkdown(template);
}
