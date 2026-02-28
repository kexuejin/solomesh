export interface WorkflowTemplateEditSystemPayload {
  templateId: string;
  scope: 'user' | 'global';
  status: 'draft_saved' | 'published' | 'publish_failed';
  summary: string;
  version?: number;
  publishable: boolean;
  reason?: string;
}

export interface WorkflowDependencyIssueSystemPayload {
  type: 'provider' | 'skill' | 'channel' | 'mcp';
  ref: string;
  reason: string;
  hint: string;
  onMissing: 'auto_fix' | 'guide_user' | 'fallback' | 'fail';
  required: boolean;
  suggestedTab: WorkflowDependencySuggestedTab | null;
}

export type WorkflowDependencySuggestedTab = 'runtime' | 'my-channels' | 'skills' | 'workflows';

export interface WorkflowDependencyBlockedSystemPayload {
  templateId: string;
  stageId: string;
  stageName: string;
  blockedReason: string;
  dependencies: WorkflowDependencyIssueSystemPayload[];
  suggestedTabs: WorkflowDependencySuggestedTab[];
}

export type ParsedSystemChatMessage =
  | { type: 'divider'; content: string }
  | { type: 'error'; content: string }
  | { type: 'workflow_template_edit'; payload: WorkflowTemplateEditSystemPayload }
  | { type: 'workflow_dependency_blocked'; payload: WorkflowDependencyBlockedSystemPayload };

function parseWorkflowTemplateEditPayload(
  raw: string,
): WorkflowTemplateEditSystemPayload | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const templateId = typeof parsed.templateId === 'string' ? parsed.templateId.trim() : '';
    if (!templateId) return null;
    const scope = parsed.scope === 'global' ? 'global' : 'user';
    const statusRaw = typeof parsed.status === 'string' ? parsed.status : '';
    const status: WorkflowTemplateEditSystemPayload['status'] =
      statusRaw === 'published' || statusRaw === 'publish_failed' ? statusRaw : 'draft_saved';
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const version =
      typeof parsed.version === 'number' && Number.isFinite(parsed.version)
        ? Math.max(1, Math.floor(parsed.version))
        : undefined;
    const publishable = parsed.publishable === true;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : undefined;
    return {
      templateId,
      scope,
      status,
      summary,
      ...(version ? { version } : {}),
      publishable,
      ...(reason ? { reason } : {}),
    };
  } catch {
    return null;
  }
}

function parseWorkflowDependencyBlockedPayload(
  raw: string,
): WorkflowDependencyBlockedSystemPayload | null {
  const parseSuggestedTab = (value: unknown): WorkflowDependencySuggestedTab | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (
      normalized === 'runtime'
      || normalized === 'my-channels'
      || normalized === 'skills'
      || normalized === 'workflows'
    ) {
      return normalized;
    }
    return null;
  };
  const inferSuggestedTabByType = (
    dependencyType: WorkflowDependencyIssueSystemPayload['type'],
  ): WorkflowDependencySuggestedTab => {
    if (dependencyType === 'provider') return 'runtime';
    if (dependencyType === 'channel') return 'my-channels';
    if (dependencyType === 'skill') return 'skills';
    return 'workflows';
  };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const templateId = typeof parsed.templateId === 'string' ? parsed.templateId.trim() : '';
    const stageId = typeof parsed.stageId === 'string' ? parsed.stageId.trim() : '';
    const stageName = typeof parsed.stageName === 'string' ? parsed.stageName.trim() : '';
    const blockedReason = typeof parsed.blockedReason === 'string' ? parsed.blockedReason.trim() : '';
    if (!templateId || !stageId || !stageName || !blockedReason) return null;

    const dependenciesRaw = Array.isArray(parsed.dependencies) ? parsed.dependencies : [];
    const dependencies: WorkflowDependencyIssueSystemPayload[] = [];
    for (const rawDependency of dependenciesRaw) {
      if (!rawDependency || typeof rawDependency !== 'object') continue;
      const item = rawDependency as Record<string, unknown>;
      const typeRaw = typeof item.type === 'string' ? item.type.trim().toLowerCase() : '';
      if (typeRaw !== 'provider' && typeRaw !== 'skill' && typeRaw !== 'channel' && typeRaw !== 'mcp') {
        continue;
      }
      const ref = typeof item.ref === 'string' ? item.ref.trim() : '';
      if (!ref) continue;
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      const hint = typeof item.hint === 'string' ? item.hint.trim() : '';
      const onMissingRaw = typeof item.onMissing === 'string' ? item.onMissing.trim().toLowerCase() : '';
      const onMissing: WorkflowDependencyIssueSystemPayload['onMissing'] =
        onMissingRaw === 'auto_fix' || onMissingRaw === 'fallback' || onMissingRaw === 'fail'
          ? onMissingRaw
          : 'guide_user';
      const suggestedTab = parseSuggestedTab(item.suggestedTab) ?? inferSuggestedTabByType(typeRaw);
      dependencies.push({
        type: typeRaw,
        ref,
        reason: reason || `${typeRaw}:${ref}`,
        hint,
        onMissing,
        required: item.required !== false,
        suggestedTab,
      });
    }

    const tabsRaw = Array.isArray(parsed.suggestedTabs) ? parsed.suggestedTabs : [];
    const suggestedTabs = tabsRaw
      .map((value) => parseSuggestedTab(value))
      .filter((value): value is WorkflowDependencySuggestedTab => value !== null)
      .filter((value, index, array) => array.indexOf(value) === index);
    if (suggestedTabs.length === 0 && dependencies.length > 0) {
      for (const dependency of dependencies) {
        if (!dependency.suggestedTab) continue;
        if (suggestedTabs.includes(dependency.suggestedTab)) continue;
        suggestedTabs.push(dependency.suggestedTab);
      }
    }

    return {
      templateId,
      stageId,
      stageName,
      blockedReason,
      dependencies,
      suggestedTabs,
    };
  } catch {
    return null;
  }
}

export function parseSystemChatMessage(content: string): ParsedSystemChatMessage {
  if (content === 'context_reset') {
    return { type: 'divider', content: '上下文已清除' };
  }
  if (content.startsWith('workflow_template_edit:')) {
    const payloadRaw = content.slice('workflow_template_edit:'.length).trim();
    const payload = parseWorkflowTemplateEditPayload(payloadRaw);
    if (payload) {
      return {
        type: 'workflow_template_edit',
        payload,
      };
    }
    return { type: 'divider', content: 'Workflow 模板已更新（消息格式异常）' };
  }
  if (content.startsWith('workflow_dependency_blocked:')) {
    const payloadRaw = content.slice('workflow_dependency_blocked:'.length).trim();
    const payload = parseWorkflowDependencyBlockedPayload(payloadRaw);
    if (payload) {
      return {
        type: 'workflow_dependency_blocked',
        payload,
      };
    }
    return { type: 'divider', content: 'Workflow 依赖阻塞（消息格式异常）' };
  }
  if (content.startsWith('workflow_recommend:')) {
    return {
      type: 'divider',
      content: `Workflow 推荐：${content.slice('workflow_recommend:'.length).trim()}`,
    };
  }
  if (content.startsWith('workflow:')) {
    return {
      type: 'divider',
      content: `Workflow：${content.slice('workflow:'.length).trim()}`,
    };
  }
  if (content.startsWith('agent_error:')) {
    return { type: 'error', content: content.slice('agent_error:'.length) };
  }
  if (content.startsWith('agent_max_retries:')) {
    return { type: 'error', content: content.slice('agent_max_retries:'.length) };
  }
  if (content.startsWith('context_overflow:')) {
    return { type: 'error', content: content.slice('context_overflow:'.length) };
  }
  return { type: 'divider', content };
}
