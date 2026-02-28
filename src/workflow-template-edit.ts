import type { WorkflowTemplate } from './workflow.js';

export interface WorkflowTemplateEditIntent {
  templateId: string | null;
  goal: string;
  publish: boolean;
}

const TEMPLATE_ID_RE = /^[a-z0-9][a-z0-9-_]{1,63}$/;

const UPDATE_KEYWORDS = [
  '更新',
  '修改',
  '调整',
  '优化',
  '改成',
  '改为',
  '重写',
];

function normalizeTemplateId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return TEMPLATE_ID_RE.test(normalized) ? normalized : null;
}

function stripPublishKeywords(value: string): string {
  return value
    .replace(/(?:并发布|直接发布|自动发布|发布这个修改|发布该修改)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWorkflowTemplateEditIntent(
  content: string,
): WorkflowTemplateEditIntent | null {
  const text = content.trim();
  if (!text) return null;
  if (text.startsWith('/wf')) return null;

  const hasUpdateKeyword = UPDATE_KEYWORDS.some((keyword) => text.includes(keyword));
  if (!hasUpdateKeyword || !text.includes('模板')) return null;

  const publish = /(?:并发布|直接发布|自动发布|发布这个修改|发布该修改)/i.test(text);

  const explicitPattern =
    /(?:更新|修改|调整|优化|重写|改成|改为)(?:一下)?(?:workflow|工作流)?模板\s+([a-z0-9][a-z0-9-_]{1,63})[\s：:，,]*(.+)/i;
  const explicitMatch = explicitPattern.exec(text);
  if (explicitMatch) {
    const templateId = normalizeTemplateId(explicitMatch[1]);
    const goal = stripPublishKeywords(explicitMatch[2] ?? '');
    if (!templateId || goal.length < 4) return null;
    return {
      templateId,
      goal,
      publish,
    };
  }

  const templateFirstPattern =
    /(?:把|将)\s*([a-z0-9][a-z0-9-_]{1,63})\s*(?:workflow|工作流)?模板(?:\s*(?:更新|修改|调整|优化|重写|改成|改为))?[\s：:，,]*(.+)/i;
  const templateFirstMatch = templateFirstPattern.exec(text);
  if (templateFirstMatch) {
    const templateId = normalizeTemplateId(templateFirstMatch[1]);
    const goal = stripPublishKeywords(templateFirstMatch[2] ?? '');
    if (!templateId || goal.length < 4) return null;
    return {
      templateId,
      goal,
      publish,
    };
  }

  const currentPattern =
    /(?:更新|修改|调整|优化|重写|改成|改为)(?:一下)?(?:当前|这个)?(?:workflow|工作流)?模板[\s：:，,]*(.+)/i;
  const currentMatch = currentPattern.exec(text);
  if (currentMatch) {
    const goal = stripPublishKeywords(currentMatch[1] ?? '');
    if (goal.length < 4) return null;
    return {
      templateId: null,
      goal,
      publish,
    };
  }

  return null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export function extractWorkflowTemplateJsonCandidate(content: string): unknown | null {
  const text = content.trim();
  if (!text) return null;

  const tagged = /<workflow_template_json>\s*([\s\S]*?)\s*<\/workflow_template_json>/i.exec(text);
  if (tagged && tagged[1]) {
    return parseJson(tagged[1]);
  }

  const fenced = /```json\s*([\s\S]*?)\s*```/i.exec(text);
  if (fenced && fenced[1]) {
    return parseJson(fenced[1]);
  }

  if (text.startsWith('{') && text.endsWith('}')) {
    return parseJson(text);
  }

  return null;
}

export function summarizeWorkflowTemplateChanges(
  base: WorkflowTemplate,
  next: WorkflowTemplate,
): string {
  const baseStageMap = new Map(base.stages.map((stage) => [stage.id, stage]));
  const nextStageMap = new Map(next.stages.map((stage) => [stage.id, stage]));

  const added = next.stages
    .filter((stage) => !baseStageMap.has(stage.id))
    .map((stage) => stage.id);
  const removed = base.stages
    .filter((stage) => !nextStageMap.has(stage.id))
    .map((stage) => stage.id);
  const providerChanged = next.stages
    .map((stage) => {
      const previous = baseStageMap.get(stage.id);
      if (!previous) return null;
      if (previous.defaultProvider === stage.defaultProvider) return null;
      return `${stage.id} ${previous.defaultProvider}->${stage.defaultProvider}`;
    })
    .filter((value): value is string => !!value);

  const summaryParts: string[] = [];
  if (added.length > 0) {
    summaryParts.push(`新增阶段：${added.join('、')}`);
  }
  if (removed.length > 0) {
    summaryParts.push(`删除阶段：${removed.join('、')}`);
  }
  if (providerChanged.length > 0) {
    summaryParts.push(`provider 变更：${providerChanged.join('；')}`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push('已更新模板内容（结构无增删）');
  }
  return summaryParts.join('；');
}
