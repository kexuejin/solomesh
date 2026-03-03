// --- Optional .env loader (no external dependency) ---
// Must run before any import that reads process.env at module level.
import fs from 'fs';
import path from 'path';

const dotenvPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(dotenvPath)) {
  const lines = fs.readFileSync(dotenvPath, 'utf-8').split('\n');
  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Strip optional 'export ' prefix (common in .env files)
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7);
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Do not overwrite existing env vars (explicit env takes priority)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
// --- End .env loader ---

import { ChildProcess, execFile } from 'child_process';
import crypto from 'crypto';
import { promisify } from 'util';

import { CronExpressionParser } from 'cron-parser';

import {
  APP_NAME,
  AGENT_IMAGE,
  DATA_DIR,
  GROUPS_DIR,
  STORE_DIR,
  IDLE_TIMEOUT,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  REMOTE_ACCESS_ENABLED,
  REMOTE_ACCESS_DEFAULT_TARGET_URL,
  TIMEZONE,
  validateConfig,
} from './config.js';
import {
  AvailableGroup,
  ContainerInput,
  ContainerOutput,
  runContainerAgent,
  runHostAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  closeDatabase,
  createTask,
  deleteExpiredSessions,
  deleteTask,
  ensureChatExists,
  ensureUserHomeGroup,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getEnabledChannelSessionBinding,
  getJidsByFolder,
  getLastGroupSync,
  getRegisteredGroup,
  getUserById,
  getMessagesPage,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getTaskById,
  getUserHomeGroup,
  initDatabase,
  isGroupShared,
  listUsers,
  setLastGroupSync,
  setRegisteredGroup,
  setRouterState,
  setSession,
  deleteAllSessionsForFolder,
  storeMessageDirect,
  updateChatName,
  updateTask,
  createAgent,
  getAgent,
  updateAgentStatus,
  updateAgentInfo,
  deleteCompletedTaskAgents,
  markRunningTaskAgentsAsError,
  markAllRunningTaskAgentsAsError,
  getSession,
  listAgentsByJid,
} from './db.js';
// feishu.js deprecated exports are no longer needed; imManager handles all connections
import { imManager } from './im-manager.js';
import { analyzeIntent } from './intent-analyzer.js';
import {
  appendRuntimeConfigAudit,
  getRuntimeApiKeyAutoRepairPatch,
  getRuntimeProviderConfig as getRuntimeProviderConfigForRefresh,
  getContainerEnvConfig,
  mergeRuntimeEnvConfig,
  refreshOAuthCredentials,
  saveRuntimeProviderConfig as saveRuntimeProviderConfigForRefresh,
  updateAllSessionCredentials,
} from './runtime-config.js';
import { GroupQueue } from './group-queue.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { AgentStatus, MessageCursor, NewMessage, RegisteredGroup, type ImChannel } from './types.js';
import { logger } from './logger.js';
import { listSessionCleanupPlan } from './session-cleanup.js';
import {
  startWebServer,
  broadcastToWebClients,
  broadcastNewMessage,
  broadcastTyping,
  broadcastStreamEvent,
  broadcastAgentStatus,
  remoteAccessKernel,
  shutdownTerminals,
  shutdownWebServer,
} from './web.js';
import { installSkillForUser, deleteSkillForUser } from './routes/skills.js';
import { listRuntimePrimaryMemoryFileNames } from './memory-file-alias.js';
import {
  resolveProviderDirectiveMessages,
} from './provider-directive.js';
import {
  buildWorkspaceAccessLinkRequest,
  looksLikeRemoteAccessLinkRequest,
} from './remote-access-kernel/workspace-linking.js';
import { ensureRemoteAccessTunnelRunning } from './remote-access-kernel/ensure-tunnel-running.js';
import {
  listImChannelDefinitions,
  parseImChannelFromJid,
} from './im-channel.js';
import {
  resolveEffectiveGroupForExecution,
  resolveExecutionModeForGroup,
  type GroupWithJid,
} from './group-execution-mode.js';
import {
  hasAnyEffectiveImChannelConfig,
  hasEnabledGlobalImChannelConfig,
  resolveEffectiveImChannelConfigs,
  selectEffectiveImChannelConfig,
  type EffectiveImChannelConfigs,
} from './im-channel-effective-config.js';
import { getConfiguredImChannelAvailability } from './im-channel-availability.js';
import { buildGlobalReloadCandidateConfigs } from './im-channel-reload.js';
import {
  buildGlobalImChannelConfigMap,
  buildUserImChannelConfigMap,
} from './im-channel-runtime-config.js';
import { checkWorkflowSkillDependencies } from './skills-registry.js';
import {
  AGENT_PROVIDER_IDS,
  isAgentProviderConfigured,
  type AgentProvider,
} from './agent-providers.js';
import {
  getChatRequestedOperationPermissionMode,
  resolveOperationPermissionModeForRuntime,
  type OperationPermissionMode,
} from './operation-permission-mode.js';
import {
  getChatRequestedRunOverrides,
  type ReasoningEffort,
} from './chat-run-overrides.js';
import {
  buildProviderHandoffPrompt,
  selectProviderHandoffContextMessages,
  resolveProviderHandoffTransition,
} from './provider-handoff.js';
import {
  WORKFLOW_RECOMMENDATION_TTL_MS,
  advanceWorkflowStage,
  buildWorkflowStagePrompt,
  collectWorkflowTemplateSkillRefs,
  createWorkflowSession,
  formatWorkflowStatusSummary,
  getWorkflowStage,
  getWorkflowStageProvider,
  getWorkflowTemplateForSession,
  getWorkflowTemplateRecord,
  getWorkflowTemplateRecordByRef,
  isWorkflowRecommendationExpired,
  listWorkflowTemplateIds,
  loadWorkflowTemplateRegistry,
  parseWorkflowCommand,
  parseWorkflowCommandInput,
  parseWorkflowStageReport,
  parseWorkflowPendingMap,
  parseWorkflowSessionMap,
  publishWorkflowTemplateDraft,
  serializeWorkflowTemplateRegistry,
  upsertWorkflowTemplateDraft,
  evaluateWorkflowStageTransition,
  resolveWorkflowRecommendation,
  type WorkflowStageReport,
  type WorkflowPendingRecommendation,
  type WorkflowSessionState,
} from './workflow.js';
import {
  extractWorkflowTemplateJsonCandidate,
  parseWorkflowTemplateEditIntent,
  summarizeWorkflowTemplateChanges,
  type WorkflowTemplateEditIntent,
} from './workflow-template-edit.js';
import { decideAgentErrorRetry } from './agent-error-policy.js';
import { ingestDecisionItem } from './decision-core.js';
import {
  buildAutomationTaskSpecFromChatCommand,
  listAutomationChatTemplateIds,
  parseAutomationChatCommandInput,
} from './automation-chat-command.js';
import {
  buildLinkInsightAgentPrompt,
  fetchLinkInsightSnapshot,
  parseLinkInsightAgentOutput,
  parseLinkInsightChatCommandInput,
} from './link-insight-command.js';

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const execFileAsync = promisify(execFile);
const DEFAULT_MAIN_JID = 'web:main';
const DEFAULT_MAIN_NAME = 'Main';
const SAFE_REQUEST_ID_RE = /^[A-Za-z0-9_-]+$/;

let globalMessageCursor: MessageCursor = { timestamp: '', id: '' };
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, MessageCursor> = {};
let chatProviderSelections: Record<string, AgentProvider> = {};
let chatProviderPendingHandoffFrom: Record<string, AgentProvider> = {};
let chatWorkflowStates: Record<string, WorkflowSessionState> = {};
let chatWorkflowPendingRecommendations: Record<string, WorkflowPendingRecommendation> = {};
let messageLoopRunning = false;
let ipcWatcherRunning = false;
let shuttingDown = false;

const queue = new GroupQueue();
const EMPTY_CURSOR: MessageCursor = { timestamp: '', id: '' };
const terminalWarmupInFlight = new Set<string>();

function resolveEffectiveProvider(
  group: RegisteredGroup,
  providerOverride?: AgentProvider,
): AgentProvider {
  if (providerOverride) return providerOverride;
  const globalConfig = getRuntimeProviderConfigForRefresh();
  const groupOverride = getContainerEnvConfig(group.folder);
  return mergeRuntimeEnvConfig(globalConfig, groupOverride).agentRuntime;
}

function getProviderSessionSlot(provider: AgentProvider): string {
  return `provider:${provider}`;
}

function getAgentProviderSessionSlot(
  agentId: string,
  provider: AgentProvider,
): string {
  return `${agentId}@${provider}`;
}

function isCursorAfter(candidate: MessageCursor, base: MessageCursor): boolean {
  if (candidate.timestamp > base.timestamp) return true;
  if (candidate.timestamp < base.timestamp) return false;
  return candidate.id > base.id;
}

function normalizeCursor(value: unknown): MessageCursor {
  if (typeof value === 'string') {
    return { timestamp: value, id: '' };
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { timestamp?: unknown }).timestamp === 'string'
  ) {
    const maybeId = (value as { id?: unknown }).id;
    return {
      timestamp: (value as { timestamp: string }).timestamp,
      id: typeof maybeId === 'string' ? maybeId : '',
    };
  }
  return { ...EMPTY_CURSOR };
}

function sendSystemMessage(jid: string, type: string, detail: string): void {
  const msgId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  ensureChatExists(jid);
  storeMessageDirect(msgId, jid, '__system__', 'system', `${type}:${detail}`, timestamp, true);
  broadcastNewMessage(jid, {
    id: msgId,
    chat_jid: jid,
    sender: '__system__',
    sender_name: 'system',
    content: `${type}:${detail}`,
    timestamp,
    is_from_me: true,
  });
}

async function maybeReplyWorkspaceRemoteAccessLink(
  chatJid: string,
  group: RegisteredGroup,
  messages: NewMessage[],
): Promise<boolean> {
  const userMessages = messages.filter(
    (item) => item.sender !== 'solomesh-agent' && item.sender !== '__system__',
  );
  if (userMessages.length === 0) return false;
  if (userMessages.some((item) => !!item.attachments)) return false;
  if (userMessages.some((item) => !looksLikeRemoteAccessLinkRequest(item.content))) {
    return false;
  }

  if (!REMOTE_ACCESS_ENABLED) {
    await sendMessage(
      chatJid,
      'Remote access is disabled on this server (REMOTE_ACCESS_ENABLED=false).',
    );
    return true;
  }

  try {
    await ensureRemoteAccessTunnelRunning({
      kernel: remoteAccessKernel,
      defaultTargetUrl: REMOTE_ACCESS_DEFAULT_TARGET_URL,
    });
    const preferences = await remoteAccessKernel.getLinkPreferences();
    const link = await remoteAccessKernel.createAccessLink(
      buildWorkspaceAccessLinkRequest(group.folder, preferences),
    );
    await sendMessage(
      chatJid,
      `Remote access link for workspace "${group.name}": ${link.url}`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint = message.includes('Tunnel is not running')
      ? 'Start a tunnel in Settings > Remote Access first, then retry.'
      : message;
    await sendMessage(
      chatJid,
      `Failed to create remote access link for workspace "${group.name}": ${hint}`,
    );
    logger.warn(
      { chatJid, folder: group.folder, err: message },
      'Failed to auto-reply workspace remote access link',
    );
    return true;
  }
}

interface WorkflowTemplateEditSystemMessagePayload {
  templateId: string;
  scope: 'user' | 'global';
  status: 'draft_saved' | 'published' | 'publish_failed';
  summary: string;
  version?: number;
  publishable: boolean;
  reason?: string;
}

function sendWorkflowTemplateEditSystemMessage(
  jid: string,
  payload: WorkflowTemplateEditSystemMessagePayload,
): void {
  sendSystemMessage(
    jid,
    'workflow_template_edit',
    JSON.stringify(payload),
  );
}

interface WorkflowDependencyIssueSystemPayload {
  type: 'provider' | 'skill' | 'channel' | 'mcp';
  ref: string;
  reason: string;
  hint: string;
  onMissing: 'auto_fix' | 'guide_user' | 'fallback' | 'fail';
  required: boolean;
  suggestedTab: WorkflowDependencySuggestedTab | null;
}

type WorkflowDependencySuggestedTab = 'runtime' | 'my-channels' | 'skills' | 'workflows';

interface WorkflowDependencyBlockedSystemPayload {
  templateId: string;
  stageId: string;
  stageName: string;
  blockedReason: string;
  dependencies: WorkflowDependencyIssueSystemPayload[];
  suggestedTabs: WorkflowDependencySuggestedTab[];
}

function sendWorkflowDependencyBlockedSystemMessage(
  jid: string,
  payload: WorkflowDependencyBlockedSystemPayload,
): void {
  sendSystemMessage(
    jid,
    'workflow_dependency_blocked',
    JSON.stringify(payload),
  );
}

function getWorkflowOwnerUserId(chatJid: string): string | null {
  const group = getRegisteredGroup(chatJid);
  if (!group) return null;
  return typeof group.created_by === 'string' && group.created_by.trim().length > 0
    ? group.created_by
    : null;
}

function formatWorkflowTemplateUsage(ownerUserId: string | null): string {
  const templateIds = listWorkflowTemplateIds({ ownerUserId });
  if (templateIds.length === 0) return '(暂无可用模板)';
  return templateIds.join('、');
}

function getLatestWorkflowTemplateEditIntent(
  chatJid: string,
  messages: NewMessage[],
): { intent: WorkflowTemplateEditIntent; message: NewMessage } | null {
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    const message = messages[idx];
    if (!message || message.sender === '__system__') continue;
    if (message.attachments && message.attachments !== '[]') return null;
    const intent = parseWorkflowTemplateEditIntent(message.content);
    if (!intent) return null;

    if (!intent.templateId && !chatWorkflowStates[chatJid]?.templateId) {
      return null;
    }

    return { intent, message };
  }
  return null;
}

function buildWorkflowTemplateEditPrompt(options: {
  templateJson: string;
  templateId: string;
  goal: string;
}): string {
  const { templateJson, templateId, goal } = options;
  return [
    '你是 Workflow 模板编辑助手。',
    '请严格基于“当前模板 JSON”和“改动目标”输出完整模板 JSON。',
    `硬约束：template.id 必须保持为 ${templateId}，provider 只允许 claude/codex/gemini。`,
    '不要调用任何工具，也不要输出解释。',
    '只输出如下标签包裹的 JSON：',
    '<workflow_template_json>',
    '{...}',
    '</workflow_template_json>',
    '',
    `改动目标：${goal}`,
    '',
    '当前模板 JSON：',
    '```json',
    templateJson,
    '```',
  ].join('\n');
}

async function maybeHandleWorkflowTemplateEditMessages(
  chatJid: string,
  group: RegisteredGroup,
  messages: NewMessage[],
): Promise<boolean> {
  const matched = getLatestWorkflowTemplateEditIntent(chatJid, messages);
  if (!matched) return false;

  const ownerUserId = getWorkflowOwnerUserId(chatJid);
  if (!ownerUserId) {
    sendSystemMessage(
      chatJid,
      'workflow',
      '模板更新失败：当前会话没有可识别的用户归属，无法创建用户草稿。',
    );
    return true;
  }

  const templateId = matched.intent.templateId ?? chatWorkflowStates[chatJid]?.templateId ?? null;
  if (!templateId) {
    sendSystemMessage(
      chatJid,
      'workflow',
      '模板更新失败：未指定模板，请在消息中写明模板 ID（如 feature-delivery）。',
    );
    return true;
  }

  const sourceRecord = getWorkflowTemplateRecord(templateId, { ownerUserId });
  if (!sourceRecord) {
    sendSystemMessage(
      chatJid,
      'workflow',
      `模板更新失败：模板不存在（${templateId}）。可选：${formatWorkflowTemplateUsage(ownerUserId)}`,
    );
    return true;
  }

  const providerOverride =
    chatProviderSelections[chatJid]
    ?? getWorkflowStageProvider(getRunningWorkflowState(chatJid))
    ?? undefined;
  const prompt = buildWorkflowTemplateEditPrompt({
    templateJson: JSON.stringify(sourceRecord.template, null, 2),
    templateId: sourceRecord.template.id,
    goal: matched.intent.goal,
  });

  let rawModelOutput = '';
  await setTyping(chatJid, true);
  const output = await runAgent(
    group,
    prompt,
    chatJid,
    providerOverride,
    async (result) => {
      if (result.status === 'stream') return;
      if (!result.result) return;
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      if (raw.trim()) {
        rawModelOutput = raw;
      }
    },
  );
  await setTyping(chatJid, false);

  if (output.status === 'error') {
    sendSystemMessage(
      chatJid,
      'workflow',
      `模板更新失败：AI 生成异常（${output.error || 'unknown'}）`,
    );
    return true;
  }

  if (!rawModelOutput.trim()) {
    sendSystemMessage(chatJid, 'workflow', '模板更新失败：AI 未返回可解析内容。');
    return true;
  }

  let candidate: unknown;
  try {
    candidate = extractWorkflowTemplateJsonCandidate(rawModelOutput);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendSystemMessage(chatJid, 'workflow', `模板更新失败：解析 JSON 出错（${message}）`);
    return true;
  }
  if (!candidate || typeof candidate !== 'object') {
    sendSystemMessage(chatJid, 'workflow', '模板更新失败：未找到 <workflow_template_json> 块。');
    return true;
  }

  const candidateObject = candidate as Record<string, unknown>;
  const nextTemplateInput = {
    ...candidateObject,
    id: sourceRecord.template.id,
    version:
      typeof candidateObject.version === 'number'
        ? candidateObject.version
        : sourceRecord.template.version + 1,
  };

  let draftRecord: ReturnType<typeof upsertWorkflowTemplateDraft>;
  try {
    draftRecord = upsertWorkflowTemplateDraft({
      scope: 'user',
      ownerUserId,
      template: nextTemplateInput as unknown as typeof sourceRecord.template,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendSystemMessage(chatJid, 'workflow', `模板更新失败：草稿校验未通过（${message}）`);
    return true;
  }

  const changeSummary = summarizeWorkflowTemplateChanges(
    sourceRecord.template,
    draftRecord.template,
  );

  if (matched.intent.publish) {
    const dependency = checkWorkflowSkillDependencies(
      collectWorkflowTemplateSkillRefs(draftRecord.template),
      {
        scope: 'user',
        ownerUserId,
      },
    );
    if (dependency.invalidSkillRefs.length > 0 || dependency.missingSkillRefs.length > 0) {
      const dependencyParts: string[] = [];
      if (dependency.missingSkillRefs.length > 0) {
        dependencyParts.push(`缺失技能：${dependency.missingSkillRefs.join('、')}`);
      }
      if (dependency.invalidSkillRefs.length > 0) {
        dependencyParts.push(`非法技能引用：${dependency.invalidSkillRefs.join('、')}`);
      }
      saveState();
      sendWorkflowTemplateEditSystemMessage(
        chatJid,
        {
          templateId: sourceRecord.template.id,
          scope: 'user',
          status: 'publish_failed',
          summary: changeSummary,
          version: draftRecord.template.version,
          publishable: true,
          reason: dependencyParts.join('；'),
        },
      );
      return true;
    }

    const published = publishWorkflowTemplateDraft({
      scope: 'user',
      ownerUserId,
      templateId: sourceRecord.template.id,
    });
    saveState();
    if (!published) {
      sendWorkflowTemplateEditSystemMessage(
        chatJid,
        {
          templateId: sourceRecord.template.id,
          scope: 'user',
          status: 'publish_failed',
          summary: changeSummary,
          version: draftRecord.template.version,
          publishable: true,
          reason: '草稿不存在',
        },
      );
      return true;
    }
    sendWorkflowTemplateEditSystemMessage(
      chatJid,
      {
        templateId: sourceRecord.template.id,
        scope: 'user',
        status: 'published',
        summary: changeSummary,
        version: published.template.version,
        publishable: false,
      },
    );
    return true;
  }

  saveState();
  sendWorkflowTemplateEditSystemMessage(
    chatJid,
    {
      templateId: sourceRecord.template.id,
      scope: 'user',
      status: 'draft_saved',
      summary: changeSummary,
      version: draftRecord.template.version,
      publishable: true,
    },
  );
  return true;
}

function normalizeWorkflowSkillRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const ref = item.trim();
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function normalizeWorkflowFallbackProviders(value: unknown): AgentProvider[] {
  if (!Array.isArray(value)) return [];
  const providers: AgentProvider[] = [];
  const seen = new Set<AgentProvider>();
  for (const item of value) {
    if (
      typeof item !== 'string'
      || !(AGENT_PROVIDER_IDS as readonly string[]).includes(item)
    ) {
      continue;
    }
    const provider = item as AgentProvider;
    if (seen.has(provider)) continue;
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
}

function unsetWorkflowMetadataKeys(
  metadata: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...metadata,
  };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

function getWorkflowChannelAvailability(): Record<string, boolean> {
  return getConfiguredImChannelAvailability();
}

function getWorkflowMcpRefSet(): Set<string> {
  const refs = new Set<string>(['solomesh']);
  const raw = [
    process.env.SOLOMESH_WORKFLOW_MCP_REFS || '',
    process.env.SOLOMESH_MCP_REFS || '',
  ].join(',');
  for (const entry of raw.split(/[,\n]/g)) {
    const ref = entry.trim().toLowerCase();
    if (!ref) continue;
    refs.add(ref);
  }
  return refs;
}

interface WorkflowStageDependencyIssue {
  key: string;
  type: 'provider' | 'skill' | 'channel' | 'mcp';
  ref: string;
  reason: string;
  hint: string;
  onMissing: 'auto_fix' | 'guide_user' | 'fallback' | 'fail';
  required: boolean;
}

function getWorkflowDependencySuggestedTab(
  dependencyType: WorkflowStageDependencyIssue['type'],
): WorkflowDependencySuggestedTab {
  if (dependencyType === 'provider') return 'runtime';
  if (dependencyType === 'channel') return 'my-channels';
  if (dependencyType === 'skill') return 'skills';
  return 'workflows';
}

function reconcileWorkflowStageDependencies(chatJid: string): {
  blocked: boolean;
  changed: boolean;
} {
  const state = chatWorkflowStates[chatJid];
  if (!state) return { blocked: false, changed: false };
  if (state.status !== 'running' && state.status !== 'paused') {
    return { blocked: false, changed: false };
  }

  const template = getWorkflowTemplateForSession(state);
  if (!template) return { blocked: false, changed: false };
  const stage = template.stages[state.currentStageIndex] ?? null;
  if (!stage) return { blocked: false, changed: false };

  const metadata = ((state.metadata ?? {}) as Record<string, unknown>);
  const blockedBy = typeof metadata.blockedBy === 'string' ? metadata.blockedBy : '';
  const stageDependencies = Array.isArray(stage.dependencies) ? stage.dependencies : [];
  const stageSkillRefs = normalizeWorkflowSkillRefs(stage.skillRefs);
  for (const dependency of stageDependencies) {
    if (dependency.type !== 'skill') continue;
    if (typeof dependency.ref !== 'string') continue;
    const ref = dependency.ref.trim();
    if (!ref || stageSkillRefs.includes(ref)) continue;
    stageSkillRefs.push(ref);
  }

  const issues: WorkflowStageDependencyIssue[] = [];
  const blockedIssues: WorkflowStageDependencyIssue[] = [];
  const appendIssue = (issue: WorkflowStageDependencyIssue) => {
    issues.push(issue);
    if (issue.required && issue.onMissing !== 'fallback') {
      blockedIssues.push(issue);
    }
  };

  if (stageSkillRefs.length > 0) {
    const skillDependency = checkWorkflowSkillDependencies(stageSkillRefs, {
      scope: state.templateScope,
      ownerUserId: state.templateOwnerUserId,
    });
    for (const ref of skillDependency.missingSkillRefs) {
      appendIssue({
        key: `skill:${ref}`,
        type: 'skill',
        ref,
        reason: `缺失技能：${ref}`,
        hint: `请先安装技能 ${ref}`,
        onMissing: 'guide_user',
        required: true,
      });
    }
    for (const ref of skillDependency.invalidSkillRefs) {
      appendIssue({
        key: `skill:${ref}`,
        type: 'skill',
        ref,
        reason: `非法技能引用：${ref}`,
        hint: '请修复模板中的 skill 引用',
        onMissing: 'fail',
        required: true,
      });
    }
  }

  const providerAvailability = getWorkflowProviderAvailability();
  const channelAvailability = getWorkflowChannelAvailability();
  const mcpRefSet = getWorkflowMcpRefSet();
  for (const dependency of stageDependencies) {
    const ref = dependency.ref.trim().toLowerCase();
    if (!ref) continue;
    const onMissing = dependency.onMissing ?? 'guide_user';
    const required = dependency.required !== false;
    if (dependency.type === 'provider') {
      const validProvider = (AGENT_PROVIDER_IDS as readonly string[]).includes(ref);
      if (!validProvider || !providerAvailability[ref as AgentProvider]) {
        appendIssue({
          key: `provider:${ref}`,
          type: 'provider',
          ref,
          reason: validProvider ? `Provider 未配置：${ref}` : `非法 provider 依赖：${ref}`,
          hint: '请在设置-模型提供商中完成配置',
          onMissing,
          required,
        });
      }
      continue;
    }
    if (dependency.type === 'channel') {
      const available = channelAvailability[ref] === true;
      if (!available) {
        appendIssue({
          key: `channel:${ref}`,
          type: 'channel',
          ref,
          reason: `渠道未配置：${ref}`,
          hint: `请在设置-渠道配置中启用 ${ref}`,
          onMissing,
          required,
        });
      }
      continue;
    }
    if (dependency.type === 'mcp') {
      if (!mcpRefSet.has(ref)) {
        appendIssue({
          key: `mcp:${ref}`,
          type: 'mcp',
          ref,
          reason: `MCP 依赖未就绪：${ref}`,
          hint: `请确认 ${ref} MCP 已安装并在运行时可见`,
          onMissing,
          required,
        });
      }
      continue;
    }
  }

  if (blockedIssues.length === 0) {
    if (
      state.status === 'paused'
      && (blockedBy === 'missing_dependency' || blockedBy === 'missing_skill')
    ) {
      const nowIso = new Date().toISOString();
      chatWorkflowStates[chatJid] = {
        ...state,
        status: 'running',
        updatedAt: nowIso,
        metadata: unsetWorkflowMetadataKeys(metadata, [
          'blockedBy',
          'blockedReason',
          'missingDependencies',
          'missingDependencyKeys',
          'missingSkillRefs',
          'invalidSkillRefs',
        ]),
      };
      sendSystemMessage(
        chatJid,
        'workflow',
        `阶段依赖已恢复，继续执行阶段 ${state.currentStageIndex + 1}/${template.stages.length}：${stage.name}`,
      );
      saveState();
      return { blocked: false, changed: true };
    }
    return {
      blocked:
        state.status === 'paused'
        && (blockedBy === 'missing_dependency' || blockedBy === 'missing_skill'),
      changed: false,
    };
  }

  const missingDependencyKeys = blockedIssues.map((item) => item.key).sort();
  const previousKeys = normalizeWorkflowSkillRefs(metadata.missingDependencyKeys).sort();
  const sameKeys =
    previousKeys.length === missingDependencyKeys.length
    && previousKeys.every((item, idx) => item === missingDependencyKeys[idx]);
  const shouldNotify = state.status !== 'paused' || blockedBy !== 'missing_dependency' || !sameKeys;

  const blockedReason = blockedIssues.map((item) => item.reason).join('；');

  const nowIso = new Date().toISOString();
  chatWorkflowStates[chatJid] = {
    ...state,
    status: 'paused',
    updatedAt: nowIso,
    metadata: {
      ...metadata,
      blockedBy: 'missing_dependency',
      blockedReason,
      missingDependencyKeys,
      missingDependencies: issues,
    },
  };
  if (shouldNotify) {
    const suggestedTabs = Array.from(
      new Set(blockedIssues.map((item) => getWorkflowDependencySuggestedTab(item.type))),
    );
    sendWorkflowDependencyBlockedSystemMessage(chatJid, {
      templateId: template.id,
      stageId: stage.id,
      stageName: stage.name,
      blockedReason,
      dependencies: blockedIssues.map((item) => ({
        type: item.type,
        ref: item.ref,
        reason: item.reason,
        hint: item.hint,
        onMissing: item.onMissing,
        required: item.required,
        suggestedTab: getWorkflowDependencySuggestedTab(item.type),
      })),
      suggestedTabs,
    });
  }
  saveState();
  return { blocked: true, changed: true };
}

function getWorkflowProviderAvailability(): Record<AgentProvider, boolean> {
  const config = getRuntimeProviderConfigForRefresh();
  return {
    claude: isAgentProviderConfigured('claude', config),
    codex: isAgentProviderConfigured('codex', config),
    gemini: isAgentProviderConfigured('gemini', config),
  };
}

function reconcileWorkflowStageProviderAvailability(chatJid: string): {
  blocked: boolean;
  provider: AgentProvider | null;
  changed: boolean;
} {
  const state = chatWorkflowStates[chatJid];
  if (!state) {
    return { blocked: false, provider: null, changed: false };
  }
  if (state.status !== 'running' && state.status !== 'paused') {
    return { blocked: false, provider: null, changed: false };
  }

  const metadata = ((state.metadata ?? {}) as Record<string, unknown>);
  const blockedBy = typeof metadata.blockedBy === 'string' ? metadata.blockedBy : '';
  const canRecoverFromProviderBlock = state.status === 'paused' && blockedBy === 'provider_unavailable';
  if (state.status === 'paused' && !canRecoverFromProviderBlock) {
    return { blocked: true, provider: null, changed: false };
  }

  const template = getWorkflowTemplateForSession(state);
  if (!template) {
    return { blocked: false, provider: null, changed: false };
  }
  const stage = template.stages[state.currentStageIndex] ?? null;
  if (!stage) {
    return { blocked: false, provider: null, changed: false };
  }

  const primaryProvider = stage.defaultProvider;
  const strictProvider = stage.strictProvider === true;
  const configuredFallbacks = normalizeWorkflowFallbackProviders(stage.fallbackProviders);
  const defaultFallback: AgentProvider =
    AGENT_PROVIDER_IDS.find((provider) => provider !== primaryProvider) ?? primaryProvider;
  const fallbackProviders = strictProvider
    ? []
    : (configuredFallbacks.length > 0 ? configuredFallbacks : [defaultFallback]);
  const candidateProviders: AgentProvider[] = [
    primaryProvider,
    ...fallbackProviders.filter((provider) => provider !== primaryProvider),
  ];
  const availability = getWorkflowProviderAvailability();
  const selectedProvider =
    candidateProviders.find((provider) => availability[provider]) ?? null;

  if (selectedProvider) {
    const nowIso = new Date().toISOString();
    let changed = false;
    const nextMetadata: Record<string, unknown> = {
      ...metadata,
    };

    if (selectedProvider !== primaryProvider) {
      const previousFallback = typeof metadata.activeFallbackProvider === 'string'
        ? metadata.activeFallbackProvider
        : null;
      const previousStageId = typeof metadata.activeFallbackStageId === 'string'
        ? metadata.activeFallbackStageId
        : null;
      if (previousFallback !== selectedProvider || previousStageId !== stage.id || canRecoverFromProviderBlock) {
        sendSystemMessage(
          chatJid,
          'workflow',
          `阶段 provider 自动降级：${primaryProvider} -> ${selectedProvider}（阶段 ${state.currentStageIndex + 1}/${template.stages.length}：${stage.name}）`,
        );
      }
      nextMetadata.activeFallbackProvider = selectedProvider;
      nextMetadata.activeFallbackStageId = stage.id;
      nextMetadata.activeFallbackFromProvider = primaryProvider;
      changed = true;
    } else if (metadata.activeFallbackProvider || metadata.activeFallbackStageId || metadata.activeFallbackFromProvider) {
      delete nextMetadata.activeFallbackProvider;
      delete nextMetadata.activeFallbackStageId;
      delete nextMetadata.activeFallbackFromProvider;
      changed = true;
    }

    if (canRecoverFromProviderBlock) {
      sendSystemMessage(
        chatJid,
        'workflow',
        `阶段 provider 可用性已恢复，继续执行阶段 ${state.currentStageIndex + 1}/${template.stages.length}：${stage.name}（provider=${selectedProvider}）`,
      );
      delete nextMetadata.blockedBy;
      delete nextMetadata.blockedReason;
      delete nextMetadata.unavailableProviders;
      changed = true;
      chatWorkflowStates[chatJid] = {
        ...state,
        status: 'running',
        updatedAt: nowIso,
        metadata: nextMetadata,
      };
    } else if (changed) {
      chatWorkflowStates[chatJid] = {
        ...state,
        updatedAt: nowIso,
        metadata: nextMetadata,
      };
    }

    if (changed) {
      saveState();
    }
    return { blocked: false, provider: selectedProvider, changed };
  }

  const blockedReason = `阶段 provider 不可用：${candidateProviders.join('、')}`;
  const previousReason = typeof metadata.blockedReason === 'string'
    ? metadata.blockedReason
    : '';
  const shouldNotify =
    state.status !== 'paused'
    || blockedBy !== 'provider_unavailable'
    || previousReason !== blockedReason;
  const nowIso = new Date().toISOString();
  chatWorkflowStates[chatJid] = {
    ...state,
    status: 'paused',
    updatedAt: nowIso,
    metadata: {
      ...metadata,
      blockedBy: 'provider_unavailable',
      blockedReason,
      unavailableProviders: candidateProviders,
    },
  };
  if (shouldNotify) {
    sendSystemMessage(
      chatJid,
      'workflow',
      `${blockedReason}。请补全凭证或调整模板 fallback 后继续。`,
    );
  }
  saveState();
  return { blocked: true, provider: null, changed: true };
}

function getRunningWorkflowState(chatJid: string): WorkflowSessionState | null {
  const state = chatWorkflowStates[chatJid];
  if (!state || state.status !== 'running') return null;
  const template = getWorkflowTemplateForSession(state);
  if (!template) return null;
  if (state.currentStageIndex < 0 || state.currentStageIndex >= template.stages.length) {
    return null;
  }
  return state;
}

function clearExpiredWorkflowRecommendation(chatJid: string, nowMs = Date.now()): boolean {
  const pending = chatWorkflowPendingRecommendations[chatJid];
  if (!pending) return false;
  if (!isWorkflowRecommendationExpired(pending, nowMs)) return false;
  delete chatWorkflowPendingRecommendations[chatJid];
  return true;
}

function maybeRecommendWorkflow(chatJid: string, messages: NewMessage[]): void {
  const existing = chatWorkflowStates[chatJid];
  if (existing && (existing.status === 'running' || existing.status === 'paused')) return;
  if (clearExpiredWorkflowRecommendation(chatJid)) {
    saveState();
  }
  if (chatWorkflowPendingRecommendations[chatJid]) return;

  const lastUserContent = [...messages]
    .reverse()
    .map((message) => message.content.trim())
    .find((value) => value.length > 0);
  if (!lastUserContent) return;
  if (parseWorkflowCommand(lastUserContent).type !== 'none') return;

  const ownerUserId = getWorkflowOwnerUserId(chatJid);
  const recommendation = resolveWorkflowRecommendation(lastUserContent, {
    ownerUserId,
  });
  if (!recommendation) return;
  const now = new Date();
  const pending: WorkflowPendingRecommendation = {
    chatJid,
    templateId: recommendation.templateId,
    templateScope: recommendation.templateScope,
    templateOwnerUserId: recommendation.templateOwnerUserId,
    reason: recommendation.reason,
    suggestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WORKFLOW_RECOMMENDATION_TTL_MS).toISOString(),
  };
  chatWorkflowPendingRecommendations[chatJid] = pending;
  saveState();
  sendSystemMessage(
    chatJid,
    'workflow_recommend',
    `建议使用模板 "${recommendation.templateId}"（${recommendation.reason}）。输入 /wf-accept 启用，或 /wf-cancel 忽略。`,
  );
}

function resolveAutomationCommandTargetChatJid(chatJid: string): string {
  const agentMarker = '#agent:';
  const markerIndex = chatJid.indexOf(agentMarker);
  if (markerIndex <= 0) return chatJid;
  return chatJid.slice(0, markerIndex);
}

function computeTaskNextRun(
  scheduleType: 'cron' | 'interval' | 'once',
  scheduleValue: string,
): string | null {
  if (scheduleType === 'cron') {
    try {
      const interval = CronExpressionParser.parse(scheduleValue, { tz: TIMEZONE });
      return interval.next().toISOString();
    } catch {
      return null;
    }
  }
  if (scheduleType === 'interval') {
    const ms = Number.parseInt(scheduleValue, 10);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return new Date(Date.now() + ms).toISOString();
  }
  const onceDate = new Date(scheduleValue);
  if (Number.isNaN(onceDate.getTime())) return null;
  return onceDate.toISOString();
}

function formatAutomationCommandUsage(): string {
  const templates = listAutomationChatTemplateIds().join('、');
  return [
    `用法：/auto <template-id> [参数]，可选模板：${templates}`,
    '示例：/auto competitor-watch repo=https://github.com/OpenHands/OpenHands branch=main lookback=50',
    '可选参数：cron="0 11 * * 1-5" | interval_ms=600000 | once=2026-03-03T09:00:00.000Z | context=isolated|group',
  ].join('\n');
}

function formatLinkInsightCommandUsage(): string {
  return [
    '用法：/insight <url> [关注点]',
    '示例：/insight https://example.com/article 关注点=是否值得纳入下个迭代',
    '说明：会抓取文章并输出分析结论，同时直接写入决策中心。',
  ].join('\n');
}

async function handleLinkInsightChatCommand(
  chatJid: string,
  message: NewMessage,
  command: {
    url: string;
    focus: string;
  },
): Promise<boolean> {
  const targetChatJid = resolveAutomationCommandTargetChatJid(chatJid);
  const targetGroup = getRegisteredGroup(targetChatJid);
  if (!targetGroup) {
    sendSystemMessage(chatJid, 'insight', '当前会话未绑定可用工作区，无法分析链接。');
    return false;
  }

  sendSystemMessage(chatJid, 'insight', `开始分析链接：${command.url}`);

  let snapshot: Awaited<ReturnType<typeof fetchLinkInsightSnapshot>>;
  try {
    snapshot = await fetchLinkInsightSnapshot(command.url);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    sendSystemMessage(chatJid, 'insight', `链接抓取失败：${errorMsg}`);
    return false;
  }

  const providerOverride =
    chatProviderSelections[chatJid]
    ?? getWorkflowStageProvider(getRunningWorkflowState(chatJid))
    ?? undefined;
  const prompt = buildLinkInsightAgentPrompt(snapshot, command.focus);
  let rawModelOutput = '';

  await setTyping(chatJid, true);
  try {
    const output = await runAgent(
      targetGroup,
      prompt,
      chatJid,
      providerOverride,
      async (result) => {
        if (result.status === 'stream') return;
        if (!result.result) return;
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        if (raw.trim()) {
          rawModelOutput = raw;
        }
      },
    );

    if (output.status === 'error') {
      sendSystemMessage(chatJid, 'insight', `分析失败：${output.error || 'unknown'}`);
      return false;
    }
  } finally {
    await setTyping(chatJid, false);
  }

  const analysis = parseLinkInsightAgentOutput(rawModelOutput, snapshot);
  const scopeLevel = targetGroup.folder === MAIN_GROUP_FOLDER ? 'global' : 'workspace';
  const sourceHost = (() => {
    try {
      return new URL(snapshot.url).host;
    } catch {
      return 'unknown';
    }
  })();

  const decision = ingestDecisionItem(
    {
      title: analysis.decisionTitle,
      summary: analysis.decisionSummary,
      scope_level: scopeLevel,
      scope_id: scopeLevel === 'workspace' ? targetGroup.folder : undefined,
      priority: analysis.priority,
      source_type: 'manual',
      source_id: `link-insight:${sourceHost}`,
      source_run_id: `${chatJid}:${message.id}`,
      evidence: {
        url: snapshot.url,
        title: snapshot.title,
        description: snapshot.description,
        extracted_at: snapshot.extractedAt,
        focus: command.focus || null,
        key_points: analysis.keyPoints,
      },
      suggested_todo: {
        title: analysis.suggestedTodoTitle,
        description: analysis.suggestedTodoDescription,
        priority: analysis.priority,
      },
    },
    message.sender && message.sender !== '__system__'
      ? message.sender
      : 'system:insight',
  );

  const pointsPreview = analysis.keyPoints.length > 0
    ? `\n要点：${analysis.keyPoints.slice(0, 3).join('；')}`
    : '';
  sendSystemMessage(
    chatJid,
    'insight',
    `${
      decision.result === 'merged'
        ? `链接分析完成，已合并至现有决策建议（ID=${decision.decision_item_id}）。`
        : `链接分析完成，已写入决策中心（ID=${decision.decision_item_id}）。`
    }\n结论：${analysis.decisionSummary}${pointsPreview}`,
  );
  return true;
}

async function handleWorkflowControlMessages(
  chatJid: string,
  messages: NewMessage[],
): Promise<{ messages: NewMessage[]; handledCommands: boolean }> {
  const nowIso = new Date().toISOString();
  const ownerUserId = getWorkflowOwnerUserId(chatJid);
  const templateUsage = formatWorkflowTemplateUsage(ownerUserId);
  let dirty = clearExpiredWorkflowRecommendation(chatJid);
  let handledCommands = false;
  const passthrough: NewMessage[] = [];

  for (const message of messages) {
    const automationParsed = parseAutomationChatCommandInput(message.content);
    if (automationParsed.command.type !== 'none') {
      handledCommands = true;
      let commandSucceeded = false;

      if (automationParsed.command.type === 'help') {
        sendSystemMessage(chatJid, 'automation', formatAutomationCommandUsage());
      } else if (automationParsed.command.type === 'create') {
        const targetChatJid = resolveAutomationCommandTargetChatJid(chatJid);
        const targetGroup = getRegisteredGroup(targetChatJid);
        if (!targetGroup) {
          sendSystemMessage(chatJid, 'automation', '当前会话未绑定可用工作区，无法创建自动化。');
        } else {
          const built = buildAutomationTaskSpecFromChatCommand(automationParsed.command);
          if (!built.ok) {
            sendSystemMessage(
              chatJid,
              'automation',
              `创建自动化失败：${built.error}\n${formatAutomationCommandUsage()}`,
            );
          } else {
            const nextRun = computeTaskNextRun(
              built.spec.scheduleType,
              built.spec.scheduleValue,
            );
            if (!nextRun) {
              sendSystemMessage(
                chatJid,
                'automation',
                `创建自动化失败：调度配置无效（${built.spec.scheduleType}=${built.spec.scheduleValue}）`,
              );
            } else {
              const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const createdBy =
                message.sender && message.sender !== '__system__'
                  ? message.sender
                  : undefined;
              createTask({
                id: taskId,
                group_folder: targetGroup.folder,
                chat_jid: targetChatJid,
                prompt: built.spec.prompt,
                schedule_type: built.spec.scheduleType,
                schedule_value: built.spec.scheduleValue,
                context_mode: built.spec.contextMode,
                execution_type: 'agent',
                script_command: null,
                task_config: built.spec.taskConfig,
                task_state: null,
                next_run: nextRun,
                status: 'active',
                created_at: nowIso,
                created_by: createdBy,
              });
              commandSucceeded = true;
              sendSystemMessage(
                chatJid,
                'automation',
                `已创建自动化：template=${built.spec.templateId}，task=${taskId}，next_run=${nextRun}`,
              );
            }
          }
        }
      }

      const shouldPassThroughPrompt =
        commandSucceeded
        && (
          automationParsed.contentForPrompt.trim().length > 0
        || !!(message.attachments && message.attachments !== '[]')
        );
      if (shouldPassThroughPrompt) {
        passthrough.push(
          automationParsed.contentForPrompt === message.content
            ? message
            : { ...message, content: automationParsed.contentForPrompt },
        );
      }
      continue;
    }

    const linkInsightParsed = parseLinkInsightChatCommandInput(message.content);
    if (linkInsightParsed.command.type !== 'none') {
      handledCommands = true;
      let commandSucceeded = false;
      if (linkInsightParsed.command.type === 'help') {
        commandSucceeded = true;
        sendSystemMessage(chatJid, 'insight', formatLinkInsightCommandUsage());
      } else if (linkInsightParsed.command.type === 'analyze') {
        commandSucceeded = await handleLinkInsightChatCommand(chatJid, message, {
          url: linkInsightParsed.command.url,
          focus: linkInsightParsed.command.focus,
        });
      }

      const shouldPassThroughPrompt =
        commandSucceeded
        && (
          linkInsightParsed.contentForPrompt.trim().length > 0
        || !!(message.attachments && message.attachments !== '[]')
        );
      if (shouldPassThroughPrompt) {
        passthrough.push(
          linkInsightParsed.contentForPrompt === message.content
            ? message
            : { ...message, content: linkInsightParsed.contentForPrompt },
        );
      }
      continue;
    }

    const parsed = parseWorkflowCommandInput(message.content);
    const command = parsed.command;
    if (command.type === 'none') {
      passthrough.push(message);
      continue;
    }

    handledCommands = true;
    let commandSucceeded = false;
    switch (command.type) {
      case 'start': {
        if (!command.templateId) {
          sendSystemMessage(
            chatJid,
            'workflow',
            `用法：/wf <template-id>，可选模板：${templateUsage}`,
          );
          break;
        }
        const templateRecord = getWorkflowTemplateRecord(command.templateId, {
          ownerUserId,
        });
        if (!templateRecord) {
          sendSystemMessage(
            chatJid,
            'workflow',
            `模板不存在：${command.templateId}。可选：${templateUsage}`,
          );
          break;
        }
        const template = templateRecord.template;
        chatWorkflowStates[chatJid] = createWorkflowSession(chatJid, template, nowIso, {
          templateScope: templateRecord.scope,
          ownerUserId: templateRecord.ownerUserId,
        });
        delete chatWorkflowPendingRecommendations[chatJid];
        dirty = true;
        commandSucceeded = true;
        const stage = template.stages[0];
        sendSystemMessage(
          chatJid,
          'workflow',
          `已启用模板 ${template.id}（阶段 1/${template.stages.length}：${stage.name}，provider=${stage.defaultProvider}）`,
        );
        break;
      }
      case 'accept': {
        const pending = chatWorkflowPendingRecommendations[chatJid];
        if (!pending) {
          sendSystemMessage(chatJid, 'workflow', '当前没有待确认的模板推荐。');
          break;
        }
        const templateRecord = getWorkflowTemplateRecordByRef({
          scope: pending.templateScope,
          ownerUserId: pending.templateOwnerUserId,
          templateId: pending.templateId,
          lifecycle: 'published',
        });
        if (!templateRecord) {
          delete chatWorkflowPendingRecommendations[chatJid];
          dirty = true;
          sendSystemMessage(chatJid, 'workflow', '推荐模板已失效，请重新触发推荐。');
          break;
        }
        const template = templateRecord.template;
        chatWorkflowStates[chatJid] = createWorkflowSession(chatJid, template, nowIso, {
          templateScope: templateRecord.scope,
          ownerUserId: templateRecord.ownerUserId,
        });
        delete chatWorkflowPendingRecommendations[chatJid];
        dirty = true;
        commandSucceeded = true;
        const stage = template.stages[0];
        sendSystemMessage(
          chatJid,
          'workflow',
          `已确认并启用模板 ${template.id}（阶段 1/${template.stages.length}：${stage.name}，provider=${stage.defaultProvider}）`,
        );
        break;
      }
      case 'cancel': {
        if (chatWorkflowPendingRecommendations[chatJid]) {
          delete chatWorkflowPendingRecommendations[chatJid];
          dirty = true;
          commandSucceeded = true;
          sendSystemMessage(chatJid, 'workflow', '已忽略本次模板推荐。');
        } else {
          sendSystemMessage(chatJid, 'workflow', '当前没有待忽略的模板推荐。');
        }
        break;
      }
      case 'next': {
        const state = getRunningWorkflowState(chatJid);
        if (!state) {
          sendSystemMessage(chatJid, 'workflow', '当前没有运行中的工作流。');
          break;
        }
        const template = getWorkflowTemplateForSession(state);
        if (!template) {
          sendSystemMessage(chatJid, 'workflow', '工作流模板已失效，已自动退出。');
          delete chatWorkflowStates[chatJid];
          dirty = true;
          break;
        }
        const advanced = advanceWorkflowStage(state, nowIso);
        chatWorkflowStates[chatJid] = advanced.next;
        dirty = true;
        commandSucceeded = true;
        if (advanced.completed) {
          sendSystemMessage(chatJid, 'workflow', `模板 ${template.id} 已完成。`);
        } else if (advanced.moved) {
          const nextStage = getWorkflowStage(advanced.next);
          if (nextStage) {
            sendSystemMessage(
              chatJid,
              'workflow',
              `进入阶段 ${advanced.next.currentStageIndex + 1}/${template.stages.length}：${nextStage.name}（provider=${nextStage.defaultProvider}）`,
            );
          }
        }
        break;
      }
      case 'exit': {
        const state = chatWorkflowStates[chatJid];
        if (!state) {
          sendSystemMessage(chatJid, 'workflow', '当前没有工作流可退出。');
          break;
        }
        chatWorkflowStates[chatJid] = {
          ...state,
          status: 'cancelled',
          updatedAt: nowIso,
        };
        dirty = true;
        commandSucceeded = true;
        sendSystemMessage(chatJid, 'workflow', '工作流已退出。');
        break;
      }
      case 'status': {
        const state = chatWorkflowStates[chatJid] ?? null;
        commandSucceeded = true;
        const pending = chatWorkflowPendingRecommendations[chatJid];
        if (pending) {
          sendSystemMessage(
            chatJid,
            'workflow',
            `${formatWorkflowStatusSummary(state)}；待确认推荐=${pending.templateId}（输入 /wf-accept 或 /wf-cancel）`,
          );
        } else {
          sendSystemMessage(chatJid, 'workflow', formatWorkflowStatusSummary(state));
        }
        break;
      }
      default:
        break;
    }

    const shouldPassThroughPrompt =
      commandSucceeded
      && (
        parsed.contentForPrompt.trim().length > 0
      || !!(message.attachments && message.attachments !== '[]')
      );
    if (shouldPassThroughPrompt) {
      passthrough.push(
        parsed.contentForPrompt === message.content
          ? message
          : { ...message, content: parsed.contentForPrompt },
      );
    }
  }

  if (dirty) {
    saveState();
  }

  return {
    messages: passthrough,
    handledCommands,
  };
}

function formatWorkflowTransitionRejection(decision: {
  reason: string;
  confidence: number;
  missingHints: string[];
}): string {
  if (decision.reason === 'confidence_low') {
    return `阶段自动推进未通过：置信度过低（${decision.confidence.toFixed(2)}）。`;
  }
  if (decision.reason === 'required_hints_missing') {
    return `阶段自动推进未通过：缺少输出项 ${decision.missingHints.join('、')}。`;
  }
  if (decision.reason.startsWith('stage_mismatch:')) {
    return '阶段自动推进未通过：报告阶段与当前阶段不一致。';
  }
  if (decision.reason === 'keyword_without_required_hints') {
    return `阶段自动推进未通过：缺少输出项 ${decision.missingHints.join('、')}。`;
  }
  return `阶段自动推进未通过：${decision.reason}`;
}

function maybeAdvanceWorkflowFromAssistantReply(
  chatJid: string,
  assistantText: string,
  stageReport: WorkflowStageReport | null,
  activeProvider: AgentProvider,
  queueJid = chatJid,
): void {
  const runningWorkflow = getRunningWorkflowState(chatJid);
  if (!runningWorkflow) return;

  const decision = evaluateWorkflowStageTransition(
    runningWorkflow,
    assistantText,
    stageReport,
  );
  if (!decision.shouldAdvance) {
    if (stageReport?.done && decision.source === 'report') {
      sendSystemMessage(chatJid, 'workflow', formatWorkflowTransitionRejection(decision));
    }
    return;
  }

  const currentStage = getWorkflowStage(runningWorkflow);
  const shouldIngestWorkflowSuggestion = currentStage?.todoIngest?.enabled !== false;
  if (shouldIngestWorkflowSuggestion) {
    try {
      const workflowGroupFolder = registeredGroups[chatJid]?.folder ?? null;
      const scopeLevel =
        workflowGroupFolder && workflowGroupFolder !== MAIN_GROUP_FOLDER
          ? 'workspace'
          : 'global';
      const stageRef =
        `${runningWorkflow.templateId}:${currentStage?.id ?? runningWorkflow.currentStageIndex}`;
      const suggestedTitle =
        `Workflow suggestion: ${runningWorkflow.templateId}/${currentStage?.id ?? runningWorkflow.currentStageIndex}`;
      ingestDecisionItem(
        {
          title: suggestedTitle,
          summary: assistantText.slice(0, 4000),
          scope_level: scopeLevel,
          scope_id: scopeLevel === 'workspace' ? workflowGroupFolder ?? undefined : undefined,
          priority: currentStage?.todoIngest?.priority,
          source_type: 'workflow',
          source_id: stageRef,
          source_run_id: `${runningWorkflow.chatJid}:${runningWorkflow.startedAt}`,
          evidence: {
            stageId: currentStage?.id ?? null,
            stageReport,
            confidence: decision.confidence,
            provider: activeProvider,
            chatJid,
            stageIndex: runningWorkflow.currentStageIndex,
            templateVersion: runningWorkflow.templateVersion,
          },
          suggested_todo: {
            title: suggestedTitle,
            description: assistantText.slice(0, 4000),
            priority: currentStage?.todoIngest?.priority,
          },
        },
        'system:workflow',
      );
    } catch (error) {
      logger.warn(
        { chatJid, templateId: runningWorkflow.templateId, error },
        'Workflow decision ingest failed',
      );
    }
  }

  const advanced = advanceWorkflowStage(runningWorkflow);
  chatWorkflowStates[chatJid] = advanced.next;
  saveState();
  const template = getWorkflowTemplateForSession(advanced.next);
  if (advanced.completed) {
    sendSystemMessage(
      chatJid,
      'workflow',
      `模板 ${template?.id ?? advanced.next.templateId} 已自动完成。`,
    );
    return;
  }
  if (advanced.moved && template) {
    const stage = getWorkflowStage(advanced.next);
    if (stage) {
      sendSystemMessage(
        chatJid,
        'workflow',
        `自动进入阶段 ${advanced.next.currentStageIndex + 1}/${template.stages.length}：${stage.name}（provider=${stage.defaultProvider}）`,
      );
      if (stage.defaultProvider !== activeProvider) {
        queue.closeStdin(queueJid);
        logger.info(
          {
            chatJid,
            queueJid,
            fromProvider: activeProvider,
            toProvider: stage.defaultProvider,
          },
          'Workflow stage provider changed, forcing process restart for provider switch',
        );
      }
    }
  }
}

async function setTyping(jid: string, isTyping: boolean): Promise<void> {
  await imManager.setTyping(jid, isTyping);
  broadcastTyping(jid, isTyping);
}

interface SendMessageOptions {
  allowChannels?: Partial<Record<ImChannel, boolean>>;
  provider?: AgentProvider;
}

function loadState(): void {
  // Load from SQLite
  const persistedTimestamp = getRouterState('last_timestamp') || '';
  const lastTimestampId = getRouterState('last_timestamp_id') || '';
  globalMessageCursor = {
    timestamp: persistedTimestamp,
    id: lastTimestampId,
  };
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    const parsed = agentTs ? (JSON.parse(agentTs) as Record<string, unknown>) : {};
    const normalized: Record<string, MessageCursor> = {};
    for (const [jid, raw] of Object.entries(parsed)) {
      normalized[jid] = normalizeCursor(raw);
    }
    lastAgentTimestamp = normalized;
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  const providerSelectionsRaw = getRouterState('chat_provider_selections');
  try {
    const parsed = providerSelectionsRaw
      ? (JSON.parse(providerSelectionsRaw) as Record<string, unknown>)
      : {};
    const normalized: Record<string, AgentProvider> = {};
    for (const [jid, raw] of Object.entries(parsed)) {
      if (
        typeof raw === 'string'
        && (AGENT_PROVIDER_IDS as readonly string[]).includes(raw)
      ) {
        normalized[jid] = raw as AgentProvider;
      }
    }
    chatProviderSelections = normalized;
  } catch {
    logger.warn('Corrupted chat_provider_selections in DB, resetting');
    chatProviderSelections = {};
  }
  const pendingHandoffRaw = getRouterState('chat_provider_pending_handoff_from');
  try {
    const parsed = pendingHandoffRaw
      ? (JSON.parse(pendingHandoffRaw) as Record<string, unknown>)
      : {};
    const normalized: Record<string, AgentProvider> = {};
    for (const [jid, raw] of Object.entries(parsed)) {
      if (
        typeof raw === 'string'
        && (AGENT_PROVIDER_IDS as readonly string[]).includes(raw)
      ) {
        normalized[jid] = raw as AgentProvider;
      }
    }
    chatProviderPendingHandoffFrom = normalized;
  } catch {
    logger.warn('Corrupted chat_provider_pending_handoff_from in DB, resetting');
    chatProviderPendingHandoffFrom = {};
  }
  const workflowStatesRaw = getRouterState('chat_workflow_state');
  const workflowPendingRaw = getRouterState('chat_workflow_pending_recommendation');
  const workflowRegistryRaw = getRouterState('workflow_template_registry');
  loadWorkflowTemplateRegistry(workflowRegistryRaw);
  chatWorkflowStates = parseWorkflowSessionMap(workflowStatesRaw);
  chatWorkflowPendingRecommendations = parseWorkflowPendingMap(workflowPendingRaw);
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();

  // Auto-register default groups from config/default-groups.json
  const defaultGroupsPath = path.resolve(
    process.cwd(),
    'config',
    'default-groups.json',
  );
  if (fs.existsSync(defaultGroupsPath)) {
    try {
      const defaults = JSON.parse(
        fs.readFileSync(defaultGroupsPath, 'utf-8'),
      ) as Array<{
        jid: string;
        name: string;
        folder: string;
      }>;
      for (const g of defaults) {
        if (!registeredGroups[g.jid]) {
          registerGroup(g.jid, {
            name: g.name,
            folder: g.folder,
            added_at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load default groups config');
    }
  }

  // Ensure every active user has a home group (is_home=true).
  // Admin → folder='main', executionMode='host'
  // Member → folder='home-{userId}', executionMode='container'
  try {
    // Paginate through all active users
    const activeUsers: Array<{ id: string; role: string; username: string }> = [];
    {
      let page = 1;
      while (true) {
        const result = listUsers({ status: 'active', page, pageSize: 200 });
        activeUsers.push(...result.users);
        if (activeUsers.length >= result.total) break;
        page++;
      }
    }
    for (const user of activeUsers) {
      const homeJid = ensureUserHomeGroup(user.id, user.role as 'admin' | 'member', user.username);
      // Always refresh this entry from DB to pick up any patches (is_home, executionMode, etc.)
      const freshGroup = getRegisteredGroup(homeJid);
      if (freshGroup) {
        registeredGroups[homeJid] = freshGroup;
      } else if (!registeredGroups[homeJid]) {
        registeredGroups = getAllRegisteredGroups();
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to ensure user home groups');
  }

  // Enforce execution mode on all is_home groups:
  // - admin home → host mode
  // - member home → container mode
  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (!group.is_home) continue;

    // Determine expected mode based on the owner's role
    // Admin home groups use host mode, member home groups use container mode
    const isAdminHome = group.folder === MAIN_GROUP_FOLDER;
    const expectedMode = isAdminHome ? 'host' : 'container';

    if (group.executionMode !== expectedMode) {
      group.executionMode = expectedMode;
      setRegisteredGroup(jid, group);
      registeredGroups[jid] = group;
      // 清除旧 session，避免恢复不兼容的 session
      logger.info(
        { folder: group.folder, expectedMode },
        'Clearing stale session during execution mode migration',
      );
      delete sessions[group.folder];
      deleteAllSessionsForFolder(group.folder);
    }
  }

  // Initialize per-user global memory files from template for users missing them
  const primaryMemoryFileNames = listRuntimePrimaryMemoryFileNames(
    getRuntimeProviderConfigForRefresh().agentRuntime,
  );
  const templatePath = path.resolve(
    process.cwd(),
    'config',
    'global-memory-template.md',
  );
  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, 'utf-8');
    const userGlobalBase = path.join(GROUPS_DIR, 'user-global');
    // Ensure every active user has a user-global dir
    try {
      let page = 1;
      const allUsers: Array<{ id: string }> = [];
      while (true) {
        const result = listUsers({ status: 'active', page, pageSize: 200 });
        allUsers.push(...result.users);
        if (allUsers.length >= result.total) break;
        page++;
      }
      for (const u of allUsers) {
        const userDir = path.join(userGlobalBase, u.id);
        fs.mkdirSync(userDir, { recursive: true });
        let seedContent = template;
        for (const fileName of primaryMemoryFileNames) {
          const candidate = path.join(userDir, fileName);
          if (fs.existsSync(candidate)) {
            seedContent = fs.readFileSync(candidate, 'utf-8');
            break;
          }
        }
        for (const fileName of primaryMemoryFileNames) {
          const userMemoryFile = path.join(userDir, fileName);
          if (fs.existsSync(userMemoryFile)) continue;
          try {
            fs.writeFileSync(userMemoryFile, seedContent, { flag: 'wx' });
            logger.info(
              { userId: u.id, memoryFile: fileName },
              'Initialized user-global memory file from template',
            );
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
              logger.warn(
                { userId: u.id, err, memoryFile: fileName },
                'Failed to initialize user-global memory file',
              );
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize user-global memory files');
    }
  }

  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', globalMessageCursor.timestamp);
  setRouterState('last_timestamp_id', globalMessageCursor.id);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
  setRouterState(
    'chat_provider_selections',
    JSON.stringify(chatProviderSelections),
  );
  setRouterState(
    'chat_provider_pending_handoff_from',
    JSON.stringify(chatProviderPendingHandoffFrom),
  );
  setRouterState('chat_workflow_state', JSON.stringify(chatWorkflowStates));
  setRouterState(
    'chat_workflow_pending_recommendation',
    JSON.stringify(chatWorkflowPendingRecommendations),
  );
  setRouterState(
    'workflow_template_registry',
    serializeWorkflowTemplateRegistry(),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

function getRegisteredGroupWithCache(jid: string): RegisteredGroup | null {
  const cached = registeredGroups[jid];
  if (cached) return cached;
  const loaded = getRegisteredGroup(jid);
  if (loaded) {
    registeredGroups[jid] = loaded;
    return loaded;
  }
  return null;
}

function listFolderGroupCandidates(
  folder: string,
  targetJid: string,
  targetGroup: RegisteredGroup,
): GroupWithJid[] {
  const result: GroupWithJid[] = [{ jid: targetJid, ...targetGroup }];
  const seen = new Set<string>([targetJid]);
  const siblingJids = getJidsByFolder(folder);
  for (const jid of siblingJids) {
    if (seen.has(jid)) continue;
    const sibling = getRegisteredGroupWithCache(jid);
    if (!sibling) continue;
    seen.add(jid);
    result.push({ jid, ...sibling });
  }
  return result;
}

function resolveExecutionContextGroup(
  chatJid: string,
  group: RegisteredGroup,
): RegisteredGroup {
  const target: GroupWithJid = { jid: chatJid, ...group };
  const candidates = listFolderGroupCandidates(group.folder, chatJid, group);
  return resolveEffectiveGroupForExecution(target, candidates);
}

function resolveExecutionMode(
  chatJid: string,
  group: RegisteredGroup,
): 'container' | 'host' {
  const target: GroupWithJid = { jid: chatJid, ...group };
  const candidates = listFolderGroupCandidates(group.folder, chatJid, group);
  return resolveExecutionModeForGroup(target, candidates);
}

/**
 * Sync group metadata from Feishu.
 * Fetches all bot groups and stores their names in the database.
 * Called on startup, daily, and on-demand via IPC.
 */
async function syncGroupMetadata(force = false): Promise<void> {
  // Check if we need to sync (skip if synced recently, unless forced)
  if (!force) {
    const lastSync = getLastGroupSync();
    if (lastSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      const now = Date.now();
      if (now - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
        logger.debug({ lastSync }, 'Skipping group sync - synced recently');
        return;
      }
    }
  }

  // Sync groups via any connected Feishu channel instance
  await imManager.syncChannelGroupsByAnyConnectedUser('feishu');
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && parseImChannelFromJid(c.jid) !== null)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMessages(messages: NewMessage[], isShared = false): string {
  const lines = messages.map((m) => {
    const content = isShared ? `[${m.sender_name}] ${m.content}` : m.content;
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(content)}</message>`;
  });
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

function collectMessageImages(
  chatJid: string,
  messages: NewMessage[],
): Array<{ data: string; mimeType?: string }> {
  const images: Array<{ data: string; mimeType?: string }> = [];
  for (const msg of messages) {
    if (!msg.attachments) continue;
    try {
      const parsed = JSON.parse(msg.attachments);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        if ((item as { type?: unknown }).type !== 'image') continue;
        const data = (item as { data?: unknown }).data;
        if (typeof data !== 'string' || data.length === 0) continue;
        const maybeMime = (item as { mimeType?: unknown }).mimeType;
        images.push({
          data,
          mimeType: typeof maybeMime === 'string' ? maybeMime : undefined,
        });
      }
    } catch (err) {
      logger.warn(
        { chatJid, messageId: msg.id },
        'Failed to parse message attachments',
      );
    }
  }
  return images;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 *
 * Uses streaming output: agent results are sent to Feishu as they arrive.
 * The container stays alive for IDLE_TIMEOUT after each result, allowing
 * rapid-fire messages to be piped in without spawning a new container.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  let group = registeredGroups[chatJid];
  if (!group) {
    // Group may have been created after loadState (e.g., during setup/registration)
    registeredGroups = getAllRegisteredGroups();
    group = registeredGroups[chatJid];
  }
  if (!group) return true;

  // IM groups inherit execution context from workspace siblings in the same folder.
  // Priority: home workspace > web workspace > current IM group fallback.
  let effectiveGroup = resolveExecutionContextGroup(chatJid, group);
  let isHome = !!effectiveGroup.is_home;

  // Get all messages since last agent interaction
  const sinceCursor = lastAgentTimestamp[chatJid] || EMPTY_CURSOR;
  const missedMessages = getMessagesSince(chatJid, sinceCursor);

  if (missedMessages.length === 0) return true;
  const lastProcessed = missedMessages[missedMessages.length - 1];
  const workflowResolved = await handleWorkflowControlMessages(chatJid, missedMessages);
  const pendingMessages = workflowResolved.messages;
  if (pendingMessages.length === 0) {
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return true;
  }
  const remoteAccessHandled = await maybeReplyWorkspaceRemoteAccessLink(
    chatJid,
    group,
    pendingMessages,
  );
  if (remoteAccessHandled) {
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return true;
  }
  const templateEditHandled = await maybeHandleWorkflowTemplateEditMessages(
    chatJid,
    effectiveGroup,
    pendingMessages,
  );
  if (templateEditHandled) {
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return true;
  }
  const dependencyCheck = reconcileWorkflowStageDependencies(chatJid);
  if (dependencyCheck.blocked) {
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return true;
  }
  const providerPreflight = reconcileWorkflowStageProviderAvailability(chatJid);
  if (providerPreflight.blocked) {
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return true;
  }
  maybeRecommendWorkflow(chatJid, pendingMessages);

  // Admin home is shared as web:main, so select runtime owner from the latest
  // active admin sender to avoid writing global memory into another admin's
  // user-global directory.
  if (chatJid === 'web:main' && effectiveGroup.is_home) {
    for (let i = pendingMessages.length - 1; i >= 0; i--) {
      const sender = pendingMessages[i]?.sender;
      if (!sender || sender === 'solomesh-agent' || sender === '__system__') continue;
      const senderUser = getUserById(sender);
      if (senderUser?.status === 'active' && senderUser.role === 'admin') {
        effectiveGroup = { ...effectiveGroup, created_by: senderUser.id };
        break;
      }
    }
  }

  // Reply routing: feishu JIDs reply to feishu, telegram JIDs reply to telegram.
  // With the home-folder forced restart in the message loop, each JID gets its
  // own processGroupMessages call, so JID-based routing is always correct.
  const shouldReplyToFeishu = parseImChannelFromJid(chatJid) === 'feishu';

  const workflowState = getRunningWorkflowState(chatJid);
  const workflowStageProvider = providerPreflight.provider ?? getWorkflowStageProvider(workflowState);
  const directiveResolved = resolveProviderDirectiveMessages(pendingMessages);
  const requestedRunOverrides = getChatRequestedRunOverrides(chatJid);
  const requestedRuntimeOverride = requestedRunOverrides?.agentRuntimeOverride;
  const requestedModelOverride = requestedRunOverrides?.modelOverride;
  const requestedReasoningEffort = requestedRunOverrides?.reasoningEffort;
  const persistedProvider = chatProviderSelections[chatJid] ?? null;
  const pendingHandoffFrom = chatProviderPendingHandoffFrom[chatJid] ?? null;
  const directiveProvider = directiveResolved.providerOverride;
  const runtimeOverrideRequest = directiveProvider ?? requestedRuntimeOverride ?? null;
  const defaultProvider = resolveEffectiveProvider(effectiveGroup);
  const workflowAwareDefaultProvider = workflowStageProvider ?? defaultProvider;
  const isWorkflowStageActive = !!workflowStageProvider;
  const activeProvider = isWorkflowStageActive
    ? workflowAwareDefaultProvider
    : (persistedProvider ?? workflowAwareDefaultProvider);
  if (
    runtimeOverrideRequest
    && !isWorkflowStageActive
    && persistedProvider !== runtimeOverrideRequest
  ) {
    if (runtimeOverrideRequest !== activeProvider) {
      chatProviderPendingHandoffFrom[chatJid] = activeProvider;
    }
    chatProviderSelections[chatJid] = runtimeOverrideRequest;
    saveState();
  }
  const selectedProvider = runtimeOverrideRequest ?? workflowStageProvider ?? persistedProvider;
  const providerOverride = selectedProvider ?? undefined;
  const effectiveProvider = resolveEffectiveProvider(effectiveGroup, providerOverride);
  const requestedOperationPermissionMode = getChatRequestedOperationPermissionMode(chatJid);
  const operationPermissionMode = resolveOperationPermissionModeForRuntime(
    effectiveProvider,
    requestedOperationPermissionMode,
  );
  const shared = isGroupShared(group.folder);
  let prompt = formatMessages(directiveResolved.messages, shared);
  const workflowStagePrompt = buildWorkflowStagePrompt(workflowState, workflowStageProvider);
  if (workflowStagePrompt) {
    prompt = `${workflowStagePrompt}\n\n${prompt}`;
  }

  const images = collectMessageImages(chatJid, missedMessages);
  const imagesForAgent = images.length > 0 ? images : undefined;

  if (directiveResolved.hasDirective && !directiveResolved.hasPromptContent && !imagesForAgent) {
    logger.info(
      { chatJid, folder: group.folder, providerOverride: providerOverride ?? null },
      'Provider directive-only message detected, skipping agent run',
    );
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return true;
  }

  const handoffTransition = resolveProviderHandoffTransition({
    directiveProvider: runtimeOverrideRequest,
    persistedProvider: isWorkflowStageActive ? null : persistedProvider,
    defaultProvider: workflowAwareDefaultProvider,
    pendingFromProvider: pendingHandoffFrom,
    effectiveProvider,
  });
  if (handoffTransition) {
    const recentRows = getMessagesPage(chatJid, undefined, 48)
      .reverse()
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        sender_name: m.sender_name,
        content: m.content,
        timestamp: m.timestamp,
        is_from_me: m.is_from_me,
        provider: m.provider ?? null,
      }));
    const recent = selectProviderHandoffContextMessages(
      recentRows,
      missedMessages.map((m) => m.id),
      24,
    );
    const handoffPrompt = buildProviderHandoffPrompt(handoffTransition, recent);
    prompt = `${handoffPrompt}\n\n${prompt}`;
    delete chatProviderPendingHandoffFrom[chatJid];
    saveState();
    logger.info(
      {
        chatJid,
        fromProvider: handoffTransition.fromProvider,
        toProvider: handoffTransition.toProvider,
        contextMessages: recent.length,
      },
      'Injected provider handoff context',
    );
  }

  logger.info(
    {
      group: group.name,
      messageCount: missedMessages.length,
      providerOverride: providerOverride ?? null,
      operationPermissionMode,
      modelOverride: requestedModelOverride ?? null,
      reasoningEffort: requestedReasoningEffort ?? null,
      shouldReplyToFeishu,
      imageCount: images.length,
      shared,
    },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await setTyping(chatJid, true);
  let hadError = false;
  let sentReply = false;
  let lastError = '';
  let cursorCommitted = false;
  const queryTaskIds = new Set<string>();

  const pickRunningTaskForNotification = (): string | null => {
    const runningInQuery = Array.from(queryTaskIds)
      .map((id) => getAgent(id))
      .filter((a): a is NonNullable<ReturnType<typeof getAgent>> =>
        !!a && a.kind === 'task' && a.chat_jid === chatJid && a.status === 'running',
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (runningInQuery.length > 0) {
      return runningInQuery[0].id;
    }
    const runningInChat = listAgentsByJid(chatJid)
      .filter((a) => a.kind === 'task' && a.status === 'running')
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return runningInChat[0]?.id || null;
  };

  const commitCursor = (): void => {
    if (cursorCommitted) return;
    lastAgentTimestamp[chatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    cursorCommitted = true;
  };

  const output = await runAgent(
    effectiveGroup,
    prompt,
    chatJid,
    providerOverride,
    async (result) => {
      try {
        // 流式事件处理 - 广播 WebSocket + 持久化 SDK Task 生命周期到 DB
        if (result.status === 'stream' && result.streamEvent) {
          broadcastStreamEvent(chatJid, result.streamEvent);

          // Persist SDK Task lifecycle to DB so tabs survive page refresh
          const se = result.streamEvent;
          if (
            (se.eventType === 'task_start' && se.toolUseId)
            || (se.eventType === 'tool_use_start' && se.toolName === 'Task' && se.toolUseId)
          ) {
            try {
              const taskId = se.toolUseId;
              queryTaskIds.add(taskId);
              const existing = getAgent(taskId);
              const desc = se.taskDescription || se.toolInputSummary || '';
              if (!existing) {
                createAgent({
                  id: taskId,
                  group_folder: group.folder,
                  chat_jid: chatJid,
                  name: desc.slice(0, 40) || 'Task',
                  prompt: desc,
                  status: 'running',
                  kind: 'task',
                  created_by: null,
                  created_at: new Date().toISOString(),
                  completed_at: null,
                  result_summary: null,
                });
              } else if (se.taskDescription) {
                updateAgentInfo(taskId, se.taskDescription.slice(0, 40), se.taskDescription);
              }
            } catch (err) {
              logger.warn({ err, toolUseId: se.toolUseId }, 'Failed to persist task_start to DB');
            }
          }
          if (se.eventType === 'tool_use_end' && se.toolUseId) {
            try {
              const existing = getAgent(se.toolUseId);
              if (existing && existing.kind === 'task' && existing.status === 'running') {
                updateAgentStatus(se.toolUseId, 'completed');
              }
            } catch (err) {
              logger.warn({ err, toolUseId: se.toolUseId }, 'Failed to persist tool_use_end to DB');
            }
          }
          if (se.eventType === 'task_notification' && se.taskId) {
            try {
              const status = se.taskStatus === 'completed' ? 'completed' : 'error';
              const summary = se.taskSummary?.slice(0, 2000);
              let targetTaskId = se.taskId;
              let existing = getAgent(targetTaskId);
              if (!existing || existing.kind !== 'task') {
                const fallbackTaskId = pickRunningTaskForNotification();
                if (fallbackTaskId) {
                  targetTaskId = fallbackTaskId;
                  existing = getAgent(fallbackTaskId);
                  logger.warn(
                    { chatJid, sdkTaskId: se.taskId, mappedTaskId: fallbackTaskId },
                    'Task notification ID mismatch, mapped to running task',
                  );
                }
              }

              if (!existing) {
                createAgent({
                  id: targetTaskId,
                  group_folder: group.folder,
                  chat_jid: chatJid,
                  name: 'Task',
                  prompt: '',
                  status,
                  kind: 'task',
                  created_by: null,
                  created_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                  result_summary: summary || null,
                });
              } else if (existing.kind === 'task') {
                updateAgentStatus(existing.id, status, summary);
                queryTaskIds.delete(existing.id);
              }
            } catch (err) {
              logger.warn({ err, taskId: se.taskId }, 'Failed to persist task_notification to DB');
            }
          }

          return;
        }

        // Streaming output callback — called for each agent result
        if (result.result) {
          const raw =
            typeof result.result === 'string'
              ? result.result
              : JSON.stringify(result.result);
          // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
          const withoutInternal = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
          const parsedStageReport = parseWorkflowStageReport(withoutInternal);
          const text = parsedStageReport.cleanText;
          logger.info(
            { group: group.name },
            `Agent output: ${raw.slice(0, 200)}`,
          );
          if (text) {
            await sendMessage(chatJid, text, {
              allowChannels: { feishu: shouldReplyToFeishu },
              provider: effectiveProvider,
            });
            sentReply = true;
          }
          if (text || parsedStageReport.report) {
            maybeAdvanceWorkflowFromAssistantReply(
              chatJid,
              text,
              parsedStageReport.report,
              effectiveProvider,
              chatJid,
            );
            // Persist cursor as soon as a visible reply is emitted (or phase report is received).
            // Long-lived runners may stay alive for IDLE_TIMEOUT, and waiting
            // until process exit would cause duplicate replay after restart.
            commitCursor();
          }
          // Only reset idle timer on actual results, not session-update markers (result: null)
          resetIdleTimer();
        }

        if (result.status === 'error') {
          hadError = true;
          if (result.error) lastError = result.error;
        }
      } catch (err) {
        logger.error({ group: group.name, err }, 'onOutput callback failed');
        hadError = true;
      }
    },
    imagesForAgent,
    operationPermissionMode,
    requestedModelOverride,
    requestedReasoningEffort,
  );

  await setTyping(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  // 不可恢复的转录错误（如超大图片被固化在会话历史中）：无论是否已有回复，都必须重置会话
  const errorForReset = [lastError, output.error].filter(Boolean).join(' ');
  if ((output.status === 'error' || hadError) && errorForReset.includes('unrecoverable_transcript:')) {
    const detail = (lastError || output.error || '').replace(/.*unrecoverable_transcript:\s*/, '');
    logger.warn(
      { group: group.name, folder: group.folder, error: detail },
      'Unrecoverable transcript error, auto-resetting session',
    );

    // 清除会话文件（Claude 保留 settings.json，Codex 清空全部）
    // 容器创建的文件可能归属 node(1000)，先尝试直接删除，失败则用 Docker 清理
    const sessionRoot = path.join(DATA_DIR, 'sessions', group.folder);
    for (const target of listSessionCleanupPlan(sessionRoot)) {
      if (!fs.existsSync(target.dir)) continue;

      let cleared = false;
      try {
        for (const entry of fs.readdirSync(target.dir)) {
          if (target.preserve.has(entry)) continue;
          fs.rmSync(path.join(target.dir, entry), { recursive: true, force: true });
        }
        cleared = true;
      } catch {
        logger.info(
          { folder: group.folder, dir: target.dir },
          'Direct cleanup failed, using Docker fallback',
        );
      }

      if (!cleared) {
        const preserveFilter =
          target.preserve.size > 0
            ? ` ${Array.from(target.preserve).map((name) => `-not -name ${name}`).join(' ')}`
            : '';
        try {
          await execFileAsync(
            'docker',
            [
              'run',
              '--rm',
              '-v',
              `${target.dir}:/target`,
              AGENT_IMAGE,
              'sh',
              '-c',
              `find /target -mindepth 1${preserveFilter} -exec rm -rf {} + 2>/dev/null; exit 0`,
            ],
            { timeout: 15_000 },
          );
        } catch (err) {
          logger.error(
            { folder: group.folder, dir: target.dir, err },
            'Docker fallback cleanup also failed',
          );
        }
      }
    }

    // 清除 DB 和内存中的 session 记录
    try {
      deleteAllSessionsForFolder(group.folder);
      delete sessions[group.folder];
    } catch (err) {
      logger.error({ folder: group.folder, err }, 'Failed to clear session state during auto-reset');
    }

    sendSystemMessage(chatJid, 'context_reset', `会话已自动重置：${detail}`);
    commitCursor();
    return true;
  }

  // Query 出错时，将残留 running task 标记为 error，避免长期僵尸状态。
  // 正常退出不做强制 completed，避免把未确认完成的任务误判为已完成。
  const isErrorExit = output.status === 'error' || hadError;
  if (isErrorExit) {
    try {
      const marked = markRunningTaskAgentsAsError(chatJid);
      if (marked > 0) {
        logger.info({ chatJid, marked }, 'Marked remaining running task agents as error');
      }
    } catch (err) {
      logger.warn({ chatJid, err }, 'Failed to mark running task agents');
    }
  } else {
    // Safety net: if query already ended successfully but some task agents are still
    // running (usually due SDK event ID mismatch), force-complete them to avoid stale tabs.
    try {
      let completed = 0;
      for (const taskId of queryTaskIds) {
        const agent = getAgent(taskId);
        if (!agent || agent.kind !== 'task' || agent.chat_jid !== chatJid || agent.status !== 'running') continue;
        updateAgentStatus(taskId, 'completed', agent.result_summary || '任务已完成');
        broadcastAgentStatus(chatJid, taskId, 'completed', agent.name, agent.prompt, agent.result_summary || '任务已完成', agent.kind);
        completed += 1;
      }
      if (completed > 0) {
        logger.warn({ chatJid, completed }, 'Force-completed stale running task agents after successful query');
      }
    } catch (err) {
      logger.warn({ chatJid, err }, 'Failed to force-complete stale running task agents');
    }
  }

  if (isErrorExit && !sentReply) {
    // Only roll back cursor if no reply was sent — if the agent already
    // replied successfully, a subsequent timeout is not a real error and
    // rolling back would cause the same messages to be re-processed,
    // leading to duplicate replies.
    const errorDetail = output.error || lastError || '未知错误';

    // 上下文溢出错误：跳过重试，提交游标，通知用户
    if (errorDetail.startsWith('context_overflow:')) {
      const overflowMsg = errorDetail.replace(/^context_overflow:\s*/, '');
      sendSystemMessage(chatJid, 'context_overflow', overflowMsg);
      logger.warn(
        { group: group.name, error: overflowMsg },
        'Context overflow detected, skipping retry',
      );
      commitCursor();
      return true;
    }

    const retryDecision = decideAgentErrorRetry(effectiveProvider, errorDetail);
    if (!retryDecision.shouldRetry) {
      const userError = retryDecision.userFacingMessage || errorDetail;
      sendSystemMessage(chatJid, 'agent_error', userError);
      logger.warn(
        {
          group: group.name,
          provider: effectiveProvider,
          error: errorDetail,
          userError,
        },
        'Terminal agent error detected, skipping retry',
      );
      commitCursor();
      return true;
    }

    sendSystemMessage(chatJid, 'agent_error', errorDetail);
    logger.warn(
      { group: group.name, error: errorDetail },
      'Agent error (no reply sent), keeping cursor at previous position for retry',
    );
    return false;
  }

  // Final fallback for silent-success paths (no visible reply).
  if (!isErrorExit && !sentReply) {
    broadcastStreamEvent(chatJid, {
      eventType: 'status',
      statusText: 'completed_no_output',
    });
  }
  commitCursor();

  return true;
}

async function runTerminalWarmup(chatJid: string): Promise<void> {
  const group = registeredGroups[chatJid];
  if (!group) return;
  if ((group.executionMode || 'container') === 'host') return;

  logger.info({ chatJid, group: group.name }, 'Starting terminal warmup run');

  const warmupReadyToken = '<terminal_ready>';
  const warmupPrompt = [
    '这是系统触发的终端预热请求。',
    `请只回复 ${warmupReadyToken}，不要回复其它内容，也不要调用工具。`,
  ].join(' ');

  let bootstrapCompleted = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ chatJid, group: group.name }, 'Terminal warmup idle timeout, closing stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  try {
    const output = await runAgent(
      group,
      warmupPrompt,
      chatJid,
      undefined,
      async (result) => {
        if (result.status === 'stream' && result.streamEvent) {
          broadcastStreamEvent(chatJid, result.streamEvent);
          return;
        }

        if (result.status === 'error') return;

        // During warmup query, NEVER emit assistant text to chat.
        // Only mark bootstrap complete after the session update marker.
        if (result.result === null) {
          if (!bootstrapCompleted) {
            bootstrapCompleted = true;
            resetIdleTimer();
          }
          return;
        }

        if (!bootstrapCompleted) return;

        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        if (!text || text === warmupReadyToken) return;
        await sendMessage(chatJid, text);
        resetIdleTimer();
      },
    );

    if (output.status === 'error') {
      logger.warn(
        { chatJid, group: group.name, error: output.error },
        'Terminal warmup run ended with error',
      );
    } else {
      logger.info({ chatJid, group: group.name }, 'Terminal warmup run completed');
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

function ensureTerminalContainerStarted(chatJid: string): boolean {
  const group = registeredGroups[chatJid];
  if (!group) return false;
  if ((group.executionMode || 'container') === 'host') return false;

  const status = queue.getStatus();
  const groupStatus = status.groups.find((g) => g.jid === chatJid);
  if (groupStatus?.active) return true;
  if (terminalWarmupInFlight.has(chatJid)) return true;

  terminalWarmupInFlight.add(chatJid);
  const taskId = `terminal-warmup:${chatJid}`;
  queue.enqueueTask(chatJid, taskId, async () => {
    try {
      await runTerminalWarmup(chatJid);
    } finally {
      terminalWarmupInFlight.delete(chatJid);
    }
  });
  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  providerOverride?: AgentProvider,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  images?: Array<{ data: string; mimeType?: string }>,
  operationPermissionMode?: OperationPermissionMode,
  modelOverride?: string,
  reasoningEffort?: ReasoningEffort,
): Promise<{ status: 'success' | 'error'; error?: string }> {
  const isHome = !!group.is_home;
  // For the agent-runner: isMain means this is an admin home container (full privileges)
  const isAdminHome = isHome && group.folder === MAIN_GROUP_FOLDER;
  const effectiveProvider = resolveEffectiveProvider(group, providerOverride);
  const resolvedOperationPermissionMode = resolveOperationPermissionModeForRuntime(
    effectiveProvider,
    operationPermissionMode,
  );
  const sessionSlot = getProviderSessionSlot(effectiveProvider);
  const sessionId = getSession(group.folder, sessionSlot) || undefined;

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isAdminHome,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (admin home only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isAdminHome,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        // 仅从成功的输出中更新 session ID；
        // error 输出可能携带 stale ID，会覆盖流式传递的有效 session
        if (output.newSessionId && output.status !== 'error') {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId, sessionSlot);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const executionMode = group.executionMode || 'container';

  const onProcessCb = (proc: ChildProcess, identifier: string) => {
      // 宿主机模式：containerName 传 null，走 process.kill() 路径
      const containerName = executionMode === 'container' ? identifier : null;
      queue.registerProcess(
        chatJid,
        proc,
        containerName,
        group.folder,
        identifier,
        undefined,
        resolvedOperationPermissionMode,
        effectiveProvider,
        modelOverride,
        reasoningEffort,
      );
    };

    let output: ContainerOutput;

    if (executionMode === 'host') {
      output = await runHostAgent(
        group,
        {
          prompt,
          sessionId,
          groupFolder: group.folder,
          chatJid,
          agentRuntimeOverride: providerOverride,
          isMain: isAdminHome,
          isHome,
          isAdminHome,
          images,
          operationPermissionMode: resolvedOperationPermissionMode,
          modelOverride,
          reasoningEffort,
        },
        onProcessCb,
        wrappedOnOutput,
      );
    } else {
      output = await runContainerAgent(
        group,
        {
          prompt,
          sessionId,
          groupFolder: group.folder,
          chatJid,
          agentRuntimeOverride: providerOverride,
          isMain: isAdminHome,
          isHome,
          isAdminHome,
          images,
          operationPermissionMode: resolvedOperationPermissionMode,
          modelOverride,
          reasoningEffort,
        },
        onProcessCb,
        wrappedOnOutput,
      );
    }

    // 仅从成功的最终输出中更新 session ID；
    // error 状态的输出可能携带 stale ID，覆盖流式阶段已写入的有效 session
    if (output.newSessionId && output.status !== 'error') {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId, sessionSlot);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Agent error',
      );
      if (output.result && wrappedOnOutput) {
        try {
          await wrappedOnOutput(output);
        } catch (err) {
          logger.error(
            { group: group.name, err },
            'Failed to emit agent error output',
          );
        }
      }
      return { status: 'error', error: output.error };
    }

    return { status: 'success' };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ group: group.name, err }, 'Agent error');
    return { status: 'error', error: errorMsg };
  }
}

async function sendMessage(
  jid: string,
  text: string,
  options: SendMessageOptions = {},
): Promise<void> {
  const channel = parseImChannelFromJid(jid);
  try {
    if (channel) {
      try {
        await imManager.sendImMessage(jid, text, {
          allowChannels: options.allowChannels,
        });
      } catch (err) {
        logger.error({ jid, channel, err }, 'Failed to send message to IM channel');
      }
    }

    // Persist assistant reply so Web polling can render it and clear waiting state.
    const msgId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    ensureChatExists(jid);
    storeMessageDirect(
      msgId,
      jid,
      'solomesh-agent',
      APP_NAME,
      text,
      timestamp,
      true,
      undefined,
      options.provider ?? null,
    );

    broadcastNewMessage(jid, {
      id: msgId,
      chat_jid: jid,
      sender: 'solomesh-agent',
      sender_name: APP_NAME,
      content: text,
      timestamp,
      is_from_me: true,
      provider: options.provider ?? null,
    });
    logger.info(
      { jid, channel, length: text.length, allowChannels: options.allowChannels ?? null },
      'Message sent',
    );
    broadcastToWebClients(jid, text);
  } catch (err) {
    logger.error({ jid, err }, 'Failed to send message');
  }
}

/**
 * Check if a source group is authorized to send IPC messages to a target group.
 * - Admin home can send to any group.
 * - Non-home groups can only send to groups sharing the same folder.
 * - Member home groups can send to groups created by the same user.
 */
function canSendCrossGroupMessage(
  isAdminHome: boolean,
  isHome: boolean,
  sourceFolder: string,
  sourceGroupEntry: RegisteredGroup | undefined,
  targetGroup: RegisteredGroup | undefined,
): boolean {
  if (isAdminHome) return true;
  if (targetGroup && targetGroup.folder === sourceFolder) return true;
  if (isHome && targetGroup && sourceGroupEntry?.created_by != null && targetGroup.created_by === sourceGroupEntry.created_by) return true;
  return false;
}

function startIpcWatcher(): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    if (shuttingDown) return;
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      if (!shuttingDown) setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    for (const sourceGroup of groupFolders) {
      // Determine if this IPC directory belongs to an admin home group
      const sourceGroupEntry = Object.values(registeredGroups).find(
        (g) => g.folder === sourceGroup,
      );
      const isAdminHome = !!(sourceGroupEntry?.is_home && sourceGroup === MAIN_GROUP_FOLDER);
      const isHome = !!sourceGroupEntry?.is_home;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                const targetGroup = registeredGroups[data.chatJid];
                if (canSendCrossGroupMessage(isAdminHome, isHome, sourceGroup, sourceGroupEntry, targetGroup)) {
                  await sendMessage(data.chatJid, data.text);
                  logger.info(
                    { chatJid: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatJid: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              try {
                fs.renameSync(
                  filePath,
                  path.join(errorDir, `${sourceGroup}-${file}`),
                );
              } catch (renameErr) {
                logger.error(
                  { file, sourceGroup, renameErr },
                  'Failed to move IPC message to error directory, deleting',
                );
                try {
                  fs.unlinkSync(filePath);
                } catch {
                  /* ignore */
                }
              }
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir, { withFileTypes: true })
            .filter((entry) =>
              entry.isFile() &&
              entry.name.endsWith('.json') &&
              !entry.name.startsWith('install_skill_result_') &&
              !entry.name.startsWith('uninstall_skill_result_')
            )
            .map((entry) => entry.name);
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isAdminHome);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              try {
                fs.renameSync(
                  filePath,
                  path.join(errorDir, `${sourceGroup}-${file}`),
                );
              } catch (renameErr) {
                logger.error(
                  { file, sourceGroup, renameErr },
                  'Failed to move IPC task to error directory, deleting',
                );
                try {
                  fs.unlinkSync(filePath);
                } catch {
                  /* ignore */
                }
              }
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }

    }

    if (!shuttingDown) setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
    // For install_skill / uninstall_skill
    package?: string;
    requestId?: string;
    skillId?: string;
  },
  sourceGroup: string, // Verified identity from IPC directory
  isAdminHome: boolean, // Whether source is admin home container
): Promise<void> {
  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        // Resolve the target group from JID
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        // Authorization: non-admin-home groups can only schedule for themselves
        if (!isAdminHome && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isAdminHome || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isAdminHome || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isAdminHome || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'refresh_groups':
      // Only admin home group can request a refresh
      if (isAdminHome) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await syncGroupMetadata(true);
        // Write updated snapshot immediately
        const availableGroups = getAvailableGroups();
        writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
      }
      break;

    case 'register_group':
      // Only admin home group can register new groups
      if (!isAdminHome) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder) {
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'install_skill':
      if (data.package && data.requestId) {
        const pkg = data.package;
        const requestId = data.requestId;
        if (!SAFE_REQUEST_ID_RE.test(requestId)) {
          logger.warn({ sourceGroup, requestId }, 'Rejected install_skill request with invalid requestId');
          break;
        }
        const tasksDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks');
        const tasksDirResolved = path.resolve(tasksDir);
        const resultFileName = `install_skill_result_${requestId}.json`;
        const resultFilePath = path.resolve(tasksDir, resultFileName);
        if (!resultFilePath.startsWith(`${tasksDirResolved}${path.sep}`)) {
          logger.warn(
            { sourceGroup, requestId, resultFilePath },
            'Rejected install_skill request with unsafe result file path',
          );
          break;
        }

        // Find the user who owns this group
        const sourceGroupForSkill = Object.values(registeredGroups).find(
          (g) => g.folder === sourceGroup,
        );
        const userId = sourceGroupForSkill?.created_by;

        if (!userId) {
          logger.warn({ sourceGroup }, 'Cannot install skill: no user associated with group');
          const errorResult = JSON.stringify({ success: false, error: 'No user associated with this group' });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          break;
        }

        try {
          const result = await installSkillForUser(userId, pkg);
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, JSON.stringify(result));
          fs.renameSync(tmpPath, resultFilePath);
          logger.info(
            { sourceGroup, userId, pkg, success: result.success },
            'Skill installation via IPC completed',
          );
        } catch (err) {
          const errorResult = JSON.stringify({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          logger.error({ sourceGroup, userId, pkg, err }, 'Skill installation via IPC failed');
        }
      } else {
        logger.warn({ data }, 'Invalid install_skill request - missing required fields');
      }
      break;

    case 'uninstall_skill':
      if (data.skillId && data.requestId) {
        const skillId = data.skillId;
        const requestId = data.requestId;
        if (!SAFE_REQUEST_ID_RE.test(requestId)) {
          logger.warn({ sourceGroup, requestId }, 'Rejected uninstall_skill request with invalid requestId');
          break;
        }
        const tasksDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'tasks');
        const tasksDirResolved = path.resolve(tasksDir);
        const resultFileName = `uninstall_skill_result_${requestId}.json`;
        const resultFilePath = path.resolve(tasksDir, resultFileName);
        if (!resultFilePath.startsWith(`${tasksDirResolved}${path.sep}`)) {
          logger.warn(
            { sourceGroup, requestId, resultFilePath },
            'Rejected uninstall_skill request with unsafe result file path',
          );
          break;
        }

        const sourceGroupForUninstall = Object.values(registeredGroups).find(
          (g) => g.folder === sourceGroup,
        );
        const userId = sourceGroupForUninstall?.created_by;

        if (!userId) {
          logger.warn({ sourceGroup }, 'Cannot uninstall skill: no user associated with group');
          const errorResult = JSON.stringify({ success: false, error: 'No user associated with this group' });
          const tmpPath = `${resultFilePath}.tmp`;
          fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
          fs.writeFileSync(tmpPath, errorResult);
          fs.renameSync(tmpPath, resultFilePath);
          break;
        }

        const result = deleteSkillForUser(userId, skillId);
        const tmpPath = `${resultFilePath}.tmp`;
        fs.mkdirSync(path.dirname(resultFilePath), { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(result));
        fs.renameSync(tmpPath, resultFilePath);
        logger.info(
          { sourceGroup, userId, skillId, success: result.success },
          'Skill uninstall via IPC completed',
        );
      } else {
        logger.warn({ data }, 'Invalid uninstall_skill request - missing required fields');
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}


/**
 * Process messages for a user-created conversation agent.
 * Similar to processGroupMessages but uses agent-specific session/IPC and virtual JID.
 * The agent process stays alive for IDLE_TIMEOUT, cycling idle→running.
 */
async function processAgentConversation(chatJid: string, agentId: string): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent || agent.kind !== 'conversation') {
    logger.warn({ chatJid, agentId }, 'processAgentConversation: agent not found or not a conversation');
    return;
  }

  let group = registeredGroups[chatJid];
  if (!group) {
    registeredGroups = getAllRegisteredGroups();
    group = registeredGroups[chatJid];
  }
  if (!group) return;

  const effectiveGroup = resolveExecutionContextGroup(chatJid, group);

  const virtualChatJid = `${chatJid}#agent:${agentId}`;
  const virtualJid = virtualChatJid; // used as queue key

  // Get pending messages
  const sinceCursor = lastAgentTimestamp[virtualChatJid] || EMPTY_CURSOR;
  const missedMessages = getMessagesSince(virtualChatJid, sinceCursor);
  if (missedMessages.length === 0) return;
  const lastProcessed = missedMessages[missedMessages.length - 1];
  const workflowResolved = await handleWorkflowControlMessages(virtualChatJid, missedMessages);
  const pendingMessages = workflowResolved.messages;
  if (pendingMessages.length === 0) {
    lastAgentTimestamp[virtualChatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return;
  }
  const dependencyCheck = reconcileWorkflowStageDependencies(virtualChatJid);
  if (dependencyCheck.blocked) {
    lastAgentTimestamp[virtualChatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return;
  }
  const providerPreflight = reconcileWorkflowStageProviderAvailability(virtualChatJid);
  if (providerPreflight.blocked) {
    lastAgentTimestamp[virtualChatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return;
  }
  maybeRecommendWorkflow(virtualChatJid, pendingMessages);

  const isHome = !!effectiveGroup.is_home;
  const isAdminHome = isHome && effectiveGroup.folder === MAIN_GROUP_FOLDER;

  const workflowState = getRunningWorkflowState(virtualChatJid);
  const workflowStageProvider = providerPreflight.provider ?? getWorkflowStageProvider(workflowState);
  const directiveResolved = resolveProviderDirectiveMessages(pendingMessages);
  const requestedRunOverrides = getChatRequestedRunOverrides(virtualChatJid);
  const requestedRuntimeOverride = requestedRunOverrides?.agentRuntimeOverride;
  const requestedModelOverride = requestedRunOverrides?.modelOverride;
  const requestedReasoningEffort = requestedRunOverrides?.reasoningEffort;
  const persistedProvider = chatProviderSelections[virtualChatJid] ?? null;
  const pendingHandoffFrom = chatProviderPendingHandoffFrom[virtualChatJid] ?? null;
  const directiveProvider = directiveResolved.providerOverride;
  const runtimeOverrideRequest = directiveProvider ?? requestedRuntimeOverride ?? null;
  const defaultProvider = resolveEffectiveProvider(effectiveGroup);
  const workflowAwareDefaultProvider = workflowStageProvider ?? defaultProvider;
  const isWorkflowStageActive = !!workflowStageProvider;
  const activeProvider = isWorkflowStageActive
    ? workflowAwareDefaultProvider
    : (persistedProvider ?? workflowAwareDefaultProvider);
  if (
    runtimeOverrideRequest
    && !isWorkflowStageActive
    && persistedProvider !== runtimeOverrideRequest
  ) {
    if (runtimeOverrideRequest !== activeProvider) {
      chatProviderPendingHandoffFrom[virtualChatJid] = activeProvider;
    }
    chatProviderSelections[virtualChatJid] = runtimeOverrideRequest;
    saveState();
  }
  const selectedProvider = runtimeOverrideRequest ?? workflowStageProvider ?? persistedProvider;
  const providerOverride = selectedProvider ?? undefined;
  const effectiveProvider = resolveEffectiveProvider(
    effectiveGroup,
    providerOverride,
  );
  const requestedOperationPermissionMode = getChatRequestedOperationPermissionMode(virtualChatJid);
  const operationPermissionMode = resolveOperationPermissionModeForRuntime(
    effectiveProvider,
    requestedOperationPermissionMode,
  );
  let prompt = formatMessages(directiveResolved.messages, false);
  const workflowStagePrompt = buildWorkflowStagePrompt(workflowState, workflowStageProvider);
  if (workflowStagePrompt) {
    prompt = `${workflowStagePrompt}\n\n${prompt}`;
  }
  const images = collectMessageImages(virtualChatJid, pendingMessages);
  const imagesForAgent = images.length > 0 ? images : undefined;
  if (directiveResolved.hasDirective && !directiveResolved.hasPromptContent && !imagesForAgent) {
    logger.info(
      { chatJid, agentId, folder: effectiveGroup.folder, providerOverride: providerOverride ?? null },
      'Provider directive-only agent message detected, skipping run',
    );
    lastAgentTimestamp[virtualChatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    return;
  }

  const handoffTransition = resolveProviderHandoffTransition({
    directiveProvider: runtimeOverrideRequest,
    persistedProvider: isWorkflowStageActive ? null : persistedProvider,
    defaultProvider: workflowAwareDefaultProvider,
    pendingFromProvider: pendingHandoffFrom,
    effectiveProvider,
  });
  if (handoffTransition) {
    const recentRows = getMessagesPage(virtualChatJid, undefined, 48)
      .reverse()
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        sender_name: m.sender_name,
        content: m.content,
        timestamp: m.timestamp,
        is_from_me: m.is_from_me,
        provider: m.provider ?? null,
      }));
    const recent = selectProviderHandoffContextMessages(
      recentRows,
      missedMessages.map((m) => m.id),
      24,
    );
    const handoffPrompt = buildProviderHandoffPrompt(handoffTransition, recent);
    prompt = `${handoffPrompt}\n\n${prompt}`;
    delete chatProviderPendingHandoffFrom[virtualChatJid];
    saveState();
    logger.info(
      {
        chatJid,
        agentId,
        fromProvider: handoffTransition.fromProvider,
        toProvider: handoffTransition.toProvider,
        contextMessages: recent.length,
      },
      'Injected provider handoff context for conversation agent',
    );
  }

  // Update agent status → running
  updateAgentStatus(agentId, 'running');
  broadcastAgentStatus(chatJid, agentId, 'running', agent.name, agent.prompt);

  let sentReply = false;
  let hadError = false;

  // Track idle timer
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ agentId, chatJid }, 'Agent conversation idle timeout, closing stdin');
      queue.closeStdin(virtualJid);
    }, IDLE_TIMEOUT);
  };

  let cursorCommitted = false;
  const commitCursor = (): void => {
    if (cursorCommitted) return;
    lastAgentTimestamp[virtualChatJid] = {
      timestamp: lastProcessed.timestamp,
      id: lastProcessed.id,
    };
    saveState();
    cursorCommitted = true;
  };

  const sessionSlot = getAgentProviderSessionSlot(agentId, effectiveProvider);
  // Get or use agent-specific session
  const sessionId = getSession(effectiveGroup.folder, sessionSlot) || undefined;

  const wrappedOnOutput = async (output: ContainerOutput) => {
    // Track session
    if (output.newSessionId && output.status !== 'error') {
      setSession(effectiveGroup.folder, output.newSessionId, sessionSlot);
    }

    // Stream events
    if (output.status === 'stream' && output.streamEvent) {
      broadcastStreamEvent(chatJid, output.streamEvent, agentId);
      return;
    }

    // Agent reply
    if (output.result) {
      const raw = typeof output.result === 'string' ? output.result : JSON.stringify(output.result);
      const withoutInternal = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      const parsedStageReport = parseWorkflowStageReport(withoutInternal);
      const text = parsedStageReport.cleanText;
      if (text) {
        const msgId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        ensureChatExists(virtualChatJid);
        storeMessageDirect(
          msgId,
          virtualChatJid,
          'solomesh-agent',
          APP_NAME,
          text,
          timestamp,
          true,
          undefined,
          effectiveProvider,
        );
        broadcastNewMessage(virtualChatJid, {
          id: msgId,
          chat_jid: virtualChatJid,
          sender: 'solomesh-agent',
          sender_name: APP_NAME,
          content: text,
          timestamp,
          is_from_me: true,
          provider: effectiveProvider,
        }, agentId);
        sentReply = true;
      }
      if (text || parsedStageReport.report) {
        maybeAdvanceWorkflowFromAssistantReply(
          virtualChatJid,
          text,
          parsedStageReport.report,
          effectiveProvider,
          virtualJid,
        );
        commitCursor();
        resetIdleTimer();
      }
    }

    if (output.status === 'error') {
      hadError = true;
    }
  };

  try {
    const executionMode = effectiveGroup.executionMode || 'container';
    const onProcessCb = (proc: ChildProcess, identifier: string) => {
      const containerName = executionMode === 'container' ? identifier : null;
      queue.registerProcess(
        virtualJid,
        proc,
        containerName,
        effectiveGroup.folder,
        identifier,
        agentId,
        operationPermissionMode,
        effectiveProvider,
        requestedModelOverride,
        requestedReasoningEffort,
      );
    };

    const containerInput: ContainerInput = {
      prompt,
      sessionId,
      groupFolder: effectiveGroup.folder,
      chatJid,
      isMain: isAdminHome,
      isHome,
      isAdminHome,
      agentId,
      agentName: agent.name,
      agentRuntimeOverride: providerOverride,
      modelOverride: requestedModelOverride,
      reasoningEffort: requestedReasoningEffort,
      images: imagesForAgent,
      operationPermissionMode,
    };

    // Write tasks/groups snapshots
    const tasks = getAllTasks();
    writeTasksSnapshot(effectiveGroup.folder, isAdminHome, tasks.map((t) => ({
      id: t.id, groupFolder: t.group_folder, prompt: t.prompt,
      schedule_type: t.schedule_type, schedule_value: t.schedule_value,
      status: t.status, next_run: t.next_run,
    })));
    const availableGroups = getAvailableGroups();
    writeGroupsSnapshot(effectiveGroup.folder, isAdminHome, availableGroups, new Set(Object.keys(registeredGroups)));

    let output: ContainerOutput;
    if (executionMode === 'host') {
      output = await runHostAgent(effectiveGroup, containerInput, onProcessCb, wrappedOnOutput);
    } else {
      output = await runContainerAgent(effectiveGroup, containerInput, onProcessCb, wrappedOnOutput);
    }
    if (output.status === 'error') {
      hadError = true;
    }

    // Finalize session
    if (output.newSessionId && output.status !== 'error') {
      setSession(effectiveGroup.folder, output.newSessionId, sessionSlot);
    }

    if (!hadError && !sentReply) {
      broadcastStreamEvent(chatJid, {
        eventType: 'status',
        statusText: 'completed_no_output',
      }, agentId);
    }

    commitCursor();
  } catch (err) {
    hadError = true;
    logger.error({ agentId, chatJid, err }, 'Agent conversation error');
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }

  // Process ended → set status back to idle (conversation agents persist)
  updateAgentStatus(agentId, 'idle');
  broadcastAgentStatus(chatJid, agentId, 'idle', agent.name, agent.prompt);
}


async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info('solomesh running');

  while (!shuttingDown) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newCursor } = getNewMessages(jids, globalMessageCursor);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        globalMessageCursor = newCursor;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        // Build set of home folders: IM messages sharing a home folder must
        // force-restart the container so reply routing is correct (e.g., feishu
        // messages get feishu replies instead of being silently absorbed by web:main).
        const homeFolders = new Set<string>();
        for (const g of Object.values(registeredGroups)) {
          if (g.is_home) homeFolders.add(g.folder);
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          let group = registeredGroups[chatJid];
          if (!group) {
            const dbGroup = getRegisteredGroup(chatJid);
            if (dbGroup) {
              registeredGroups[chatJid] = dbGroup;
              group = dbGroup;
            }
          }
          if (!group) continue;
          if (group.is_home) homeFolders.add(group.folder);

          // Handle cold-cache/newly-added groups: detect home folders from DB
          // even if the in-memory map has not been fully refreshed yet.
          if (!homeFolders.has(group.folder)) {
            const siblingJids = getJidsByFolder(group.folder);
            for (const siblingJid of siblingJids) {
              const sibling =
                registeredGroups[siblingJid] ?? getRegisteredGroup(siblingJid);
              if (sibling && !registeredGroups[siblingJid]) {
                registeredGroups[siblingJid] = sibling;
              }
              if (sibling?.is_home) {
                homeFolders.add(group.folder);
                break;
              }
            }
          }

          // Pull all messages since lastAgentTimestamp to preserve full context.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || EMPTY_CURSOR,
          );
          const messagesToSend = allPending.length > 0 ? allPending : groupMessages;
          const workflowResolved = await handleWorkflowControlMessages(chatJid, messagesToSend);
          const workflowMessages = workflowResolved.messages;
          if (workflowMessages.length === 0) {
            const lastProcessed = messagesToSend[messagesToSend.length - 1];
            if (lastProcessed) {
              lastAgentTimestamp[chatJid] = {
                timestamp: lastProcessed.timestamp,
                id: lastProcessed.id,
              };
              saveState();
            }
            continue;
          }
          const remoteAccessHandled = await maybeReplyWorkspaceRemoteAccessLink(
            chatJid,
            group,
            workflowMessages,
          );
          if (remoteAccessHandled) {
            const lastProcessed = workflowMessages[workflowMessages.length - 1];
            if (lastProcessed) {
              lastAgentTimestamp[chatJid] = {
                timestamp: lastProcessed.timestamp,
                id: lastProcessed.id,
              };
              saveState();
            }
            continue;
          }
          if (getLatestWorkflowTemplateEditIntent(chatJid, workflowMessages)) {
            queue.closeStdin(chatJid);
            queue.enqueueMessageCheck(chatJid);
            logger.debug(
              { chatJid, count: workflowMessages.length },
              'Workflow template edit intent detected, rerouting to queued processing',
            );
            continue;
          }
          const dependencyCheck = reconcileWorkflowStageDependencies(chatJid);
          if (dependencyCheck.blocked) {
            const lastProcessed = workflowMessages[workflowMessages.length - 1];
            if (lastProcessed) {
              lastAgentTimestamp[chatJid] = {
                timestamp: lastProcessed.timestamp,
                id: lastProcessed.id,
              };
              saveState();
            }
            continue;
          }
          const providerPreflight = reconcileWorkflowStageProviderAvailability(chatJid);
          if (providerPreflight.blocked) {
            const lastProcessed = workflowMessages[workflowMessages.length - 1];
            if (lastProcessed) {
              lastAgentTimestamp[chatJid] = {
                timestamp: lastProcessed.timestamp,
                id: lastProcessed.id,
              };
              saveState();
            }
            queue.closeStdin(chatJid);
            continue;
          }
          maybeRecommendWorkflow(chatJid, workflowMessages);

          // Groups sharing a home folder always run as a fresh batch.
          // This prevents IM messages from being piped into an active web:main
          // container (whose onOutput callback wouldn't route replies to IM).
          if (homeFolders.has(group.folder)) {
            queue.closeStdin(chatJid);
            logger.debug(
              { chatJid },
              'Home-folder message received, forcing stdin close before enqueue',
            );
            queue.enqueueMessageCheck(chatJid);
            continue;
          }

          const directiveResolved = resolveProviderDirectiveMessages(workflowMessages);
          const hasProviderDirective = directiveResolved.hasDirective;
          const requestedRunOverrides = getChatRequestedRunOverrides(chatJid);
          const requestedRuntimeOverride = requestedRunOverrides?.agentRuntimeOverride;
          const requestedModelOverride = requestedRunOverrides?.modelOverride;
          const requestedReasoningEffort = requestedRunOverrides?.reasoningEffort;
          const shared = !group.is_home && isGroupShared(group.folder);
          let formatted = formatMessages(directiveResolved.messages, shared);
          const workflowState = getRunningWorkflowState(chatJid);
          const workflowStageProvider =
            providerPreflight.provider ?? getWorkflowStageProvider(workflowState);
          const persistedProvider = chatProviderSelections[chatJid] ?? null;
          const runtimeOverrideRequest =
            directiveResolved.providerOverride ?? requestedRuntimeOverride ?? null;
          const selectedProvider = runtimeOverrideRequest ?? workflowStageProvider ?? persistedProvider;
          const effectiveProvider = resolveEffectiveProvider(
            group,
            selectedProvider ?? undefined,
          );
          const requestedOperationPermissionMode = getChatRequestedOperationPermissionMode(chatJid);
          const operationPermissionMode = resolveOperationPermissionModeForRuntime(
            effectiveProvider,
            requestedOperationPermissionMode,
          );
          const workflowStagePrompt = buildWorkflowStagePrompt(
            workflowState,
            workflowStageProvider,
          );
          if (workflowStagePrompt) {
            formatted = `${workflowStagePrompt}\n\n${formatted}`;
          }

          const images = collectMessageImages(chatJid, workflowMessages);
          const imagesForAgent = images.length > 0 ? images : undefined;

          if (hasProviderDirective) {
            queue.closeStdin(chatJid);
            logger.debug(
              { chatJid, folder: group.folder },
              'Provider directive detected, forcing new run for provider switch',
            );
            queue.enqueueMessageCheck(chatJid);
            continue;
          }

          const intent = analyzeIntent(formatted);
          const sendResult = queue.sendMessage(
            chatJid,
            formatted,
            imagesForAgent,
            intent,
            {
              operationPermissionMode,
              agentRuntimeOverride: runtimeOverrideRequest ?? undefined,
              modelOverride: requestedModelOverride,
              reasoningEffort: requestedReasoningEffort,
            },
          );
          const handledByActiveRunner = sendResult !== 'no_active';

          if (handledByActiveRunner) {
            logger.debug(
              {
                chatJid,
                count: workflowMessages.length,
                imageCount: images.length,
                sendResult,
                intent,
                operationPermissionMode,
                modelOverride: requestedModelOverride ?? null,
                reasoningEffort: requestedReasoningEffort ?? null,
              },
              'Piped messages to active container',
            );
            const lastProcessed = workflowMessages[workflowMessages.length - 1];
            lastAgentTimestamp[chatJid] = {
              timestamp: lastProcessed.timestamp,
              id: lastProcessed.id,
            };
            saveState();
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing global cursor and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceCursor = lastAgentTimestamp[chatJid] || EMPTY_CURSOR;
    const pending = getMessagesSince(chatJid, sinceCursor);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

async function ensureDockerRunning(): Promise<void> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 10000 });
    logger.debug('Docker daemon is running');
  } catch {
    // 如果有容器模式的 group，Docker 必须运行
    const hasContainerGroups = Object.values(registeredGroups).some(
      (g) => (g.executionMode || 'container') === 'container',
    );
    if (hasContainerGroups) {
      logger.error('Docker daemon is not running');
      console.error(
        '\n╔════════════════════════════════════════════════════════════════╗',
      );
      console.error(
        '║  FATAL: Docker is not running                                  ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Agents cannot run without Docker. To fix:                     ║',
      );
      console.error(
        '║  macOS: Start Docker Desktop                                   ║',
      );
      console.error(
        '║  Linux: sudo systemctl start docker                            ║',
      );
      console.error(
        '║                                                                ║',
      );
      console.error(
        '║  Install from: https://docker.com/products/docker-desktop      ║',
      );
      console.error(
        '╚════════════════════════════════════════════════════════════════╝\n',
      );
      throw new Error('Docker is required but not running');
    } else {
      logger.warn(
        'Docker is not running, but all groups use host execution mode',
      );
    }
  }

  // Kill and clean up orphaned solomesh containers from previous runs
  try {
    const { stdout } = await execFileAsync(
      'docker',
      ['ps', '--filter', 'name=solomesh-', '--format', '{{.Names}}'],
      { timeout: 10000 },
    );
    const output = typeof stdout === 'string' ? stdout : String(stdout);
    const orphans = output.trim().split('\n').filter(Boolean);
    for (const name of orphans) {
      try {
        await execFileAsync('docker', ['stop', name], { timeout: 10000 });
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}

/**
 * Build the onNewChat callback for IM connections.
 * Feishu/Telegram chats first try explicit session binding, then fall back
 * to the user's home group folder.
 *
 * When the same Feishu app is transferred between users (e.g., admin disables
 * their channel and a member enables the same credentials), existing chats
 * are re-routed to the current connection owner on first message receipt.
 */
function buildOnNewChat(userId: string, homeFolder: string): (chatJid: string, chatName: string) => void {
  return (chatJid, chatName) => {
    const normalizedChatName = typeof chatName === 'string' ? chatName.trim() : '';
    const effectiveChatName = normalizedChatName || chatJid;
    const binding = getEnabledChannelSessionBinding(chatJid);
    const targetFolder = binding?.target_folder || homeFolder;
    // Runtime owner always follows current IM connection owner to ensure reply routing works.
    const targetOwner = userId;

    const existing = registeredGroups[chatJid];
    if (existing) {
      const shouldUpdateName = existing.name !== effectiveChatName;
      // Existing IM chat: keep non-home chat mutable so it can follow binding
      // or current owner after channel credential transfer.
      if (!existing.is_home) {
        const shouldUpdateRouting =
          existing.folder !== targetFolder || existing.created_by !== targetOwner;
        if (!shouldUpdateRouting && !shouldUpdateName) {
          return;
        }
        const previousFolder = existing.folder;
        const previousOwner = existing.created_by;
        const previousName = existing.name;
        existing.folder = targetFolder;
        existing.created_by = targetOwner;
        if (shouldUpdateName) {
          existing.name = effectiveChatName;
        }
        setRegisteredGroup(chatJid, existing);
        registeredGroups[chatJid] = existing;
        logger.info(
          {
            chatJid,
            chatName: effectiveChatName,
            userId,
            previousFolder,
            previousOwner,
            previousName,
            targetFolder,
            nameUpdated: shouldUpdateName,
            viaBinding: !!binding,
          },
          'Updated IM chat routing',
        );
      }
      return;
    }
    registerGroup(chatJid, {
      name: effectiveChatName,
      folder: targetFolder,
      added_at: new Date().toISOString(),
      created_by: targetOwner,
    });
    logger.info({ chatJid, chatName, userId, targetFolder, viaBinding: !!binding }, 'Auto-registered IM chat');
  };
}

/**
 * Connect IM channels for a specific user via imManager.
 * Reads the user's IM config and connects if enabled.
 */
async function connectUserIMChannels(
  userId: string,
  homeFolder: string,
  configs: EffectiveImChannelConfigs,
  ignoreMessagesBefore?: number,
): Promise<Record<ImChannel, boolean>> {
  const onNewChat = buildOnNewChat(userId, homeFolder);
  const result = {} as Record<ImChannel, boolean>;
  for (const def of listImChannelDefinitions()) {
    result[def.id] = false;
  }

  const connectChannel = async <C extends ImChannel>(channel: C): Promise<boolean> => {
    const channelConfig = selectEffectiveImChannelConfig(configs, channel);
    if (!channelConfig) return false;
    return imManager.connectUserChannel(
      userId,
      channel,
      channelConfig,
      onNewChat,
      { ignoreMessagesBefore },
    );
  };

  for (const def of listImChannelDefinitions()) {
    result[def.id] = await connectChannel(def.id);
  }
  return result;
}

function movePathWithFallback(src: string, dst: string): void {
  try {
    fs.renameSync(src, dst);
  } catch (err: unknown) {
    // Cross-device rename fallback.
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      fs.cpSync(src, dst, { recursive: true });
      fs.rmSync(src, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}

/**
 * One-shot migration: move legacy top-level directories into data/.
 * - store/messages.db* → data/db/messages.db*
 * - groups/            → data/groups/
 * Also supports partial migrations (old+new paths both exist).
 */
function migrateDataDirectories(): void {
  const projectRoot = process.cwd();

  // 1. Migrate store/ → data/db/
  const oldStoreDir = path.join(projectRoot, 'store');
  if (fs.existsSync(oldStoreDir)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    // Move messages.db and WAL files
    for (const file of ['messages.db', 'messages.db-wal', 'messages.db-shm']) {
      const src = path.join(oldStoreDir, file);
      const dst = path.join(STORE_DIR, file);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        movePathWithFallback(src, dst);
        logger.info({ src, dst }, 'Migrated database file');
      }
    }
    // Remove old store/ if empty
    try {
      fs.rmdirSync(oldStoreDir);
    } catch {
      // Not empty — leave it
    }
  }

  // 2. Migrate groups/ → data/groups/
  const oldGroupsDir = path.join(projectRoot, 'groups');
  if (fs.existsSync(oldGroupsDir)) {
    fs.mkdirSync(path.dirname(GROUPS_DIR), { recursive: true });
    if (!fs.existsSync(GROUPS_DIR)) {
      movePathWithFallback(oldGroupsDir, GROUPS_DIR);
      logger.info(
        { src: oldGroupsDir, dst: GROUPS_DIR },
        'Migrated groups directory',
      );
    } else {
      // Partial migration: move missing entries one-by-one.
      const entries = fs.readdirSync(oldGroupsDir, { withFileTypes: true });
      for (const entry of entries) {
        const src = path.join(oldGroupsDir, entry.name);
        const dst = path.join(GROUPS_DIR, entry.name);
        if (!fs.existsSync(dst)) {
          movePathWithFallback(src, dst);
          logger.info({ src, dst }, 'Migrated legacy group entry');
        }
      }
      try {
        fs.rmdirSync(oldGroupsDir);
      } catch {
        // Not empty — leave it
      }
    }
  }
}

async function main(): Promise<void> {
  validateConfig();
  migrateDataDirectories();
  initDatabase();
  logger.info('Database initialized');

  // Auto-repair legacy misfilled SDK keys: if a URL-like key was saved but env has a valid key, persist the valid fallback.
  try {
    const current = getRuntimeProviderConfigForRefresh();
    const { nextConfig, changedFields } =
      getRuntimeApiKeyAutoRepairPatch(current);
    if (changedFields.length > 0) {
      saveRuntimeProviderConfigForRefresh(nextConfig);
      appendRuntimeConfigAudit(
        'system',
        'auto_repair_runtime_api_keys',
        changedFields,
        { reason: 'url_like_saved_key_fallback_to_env' },
      );
      logger.warn(
        { changedFields },
        'Auto-repaired invalid runtime SDK keys using process env fallback',
      );
    }
  } catch (err) {
    logger.warn(
      { err },
      'Failed to auto-repair invalid runtime SDK keys at startup',
    );
  }

  // Clean up stale completed task agents (older than 1 hour) to prevent DB bloat
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const cleaned = deleteCompletedTaskAgents(oneHourAgo);
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up stale completed task agents');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up stale task agents');
  }

  // After process restart there cannot be truly running SDK tasks.
  // Mark all persisted running tasks as error to avoid stale "running" tabs.
  try {
    const marked = markAllRunningTaskAgentsAsError();
    if (marked > 0) {
      logger.warn({ marked }, 'Marked stale running task agents as error at startup');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to mark stale running tasks at startup');
  }

  loadState();

  // --- Channel reload helpers (hot-reload on config save) ---

  let feishuSyncInterval: ReturnType<typeof setInterval> | null = null;

  // Graceful shutdown handlers
  let shutdownInProgress = false;
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) {
      logger.warn('Force exit (second signal)');
      process.exit(1);
    }
    shutdownInProgress = true;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received, cleaning up...');

    if (feishuSyncInterval) {
      clearInterval(feishuSyncInterval);
      feishuSyncInterval = null;
    }

    try { shutdownTerminals(); } catch (err) {
      logger.warn({ err }, 'Error shutting down terminals');
    }
    try { await imManager.disconnectAll(); } catch (err) {
      logger.warn({ err }, 'Error disconnecting IM connections');
    }
    try { await shutdownWebServer(); } catch (err) {
      logger.warn({ err }, 'Error shutting down web server');
    }
    try { await queue.shutdown(10000); } catch (err) {
      logger.warn({ err }, 'Error shutting down queue');
    }
    try { closeDatabase(); } catch (err) {
      logger.warn({ err }, 'Error closing database');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  const getPrimaryActiveAdmin = () => {
    const adminUsers = listUsers({
      status: 'active',
      role: 'admin',
      page: 1,
      pageSize: 1,
    }).users;
    return adminUsers[0] || null;
  };

  const reloadAdminIMChannel = async (
    channel: ImChannel,
    candidateConfigs: EffectiveImChannelConfigs,
  ): Promise<boolean> => {
    const adminUser = getPrimaryActiveAdmin();
    if (!adminUser) {
      logger.warn({ channel }, 'No admin user found for IM reload');
      return false;
    }

    await imManager.disconnectUserChannel(adminUser.id, channel);
    if (channel === 'feishu' && feishuSyncInterval) {
      clearInterval(feishuSyncInterval);
      feishuSyncInterval = null;
    }

    const channelConfig = selectEffectiveImChannelConfig(
      candidateConfigs,
      channel,
    );
    if (!channelConfig) {
      logger.info({ channel }, 'Admin IM channel disabled via hot-reload');
      return false;
    }

    const homeGroup = getUserHomeGroup(adminUser.id);
    const homeFolder = homeGroup?.folder || MAIN_GROUP_FOLDER;
    const onNewChat = buildOnNewChat(adminUser.id, homeFolder);
    const connected = await imManager.connectUserChannel(
      adminUser.id,
      channel,
      channelConfig,
      onNewChat,
      { ignoreMessagesBefore: Date.now() },
    );

    if (channel === 'feishu' && connected) {
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Group sync after Feishu reconnect failed'),
      );
      feishuSyncInterval = setInterval(() => {
        syncGroupMetadata().catch((err) =>
          logger.error({ err }, 'Periodic group sync failed'),
        );
      }, GROUP_SYNC_INTERVAL_MS);
    }
    return connected;
  };

  const reloadGlobalIMConfig = async (
    channel: ImChannel,
    config: unknown,
  ): Promise<boolean> => {
    const candidateConfigs = buildGlobalReloadCandidateConfigs(channel, config);
    if (!candidateConfigs) {
      logger.warn({ channel }, 'Invalid global IM config for hot-reload');
      return false;
    }
    return reloadAdminIMChannel(channel, candidateConfigs);
  };

  // Reload a per-user IM channel (hot-reload on user-im config save)
  const reloadUserIMConfig = async (
    userId: string,
    channel: ImChannel,
  ): Promise<boolean> => {
    const homeGroup = getUserHomeGroup(userId);
    if (!homeGroup) {
      logger.warn({ userId, channel }, 'No home group found for user IM reload');
      return false;
    }
    const homeFolder = homeGroup.folder;
    const onNewChat = buildOnNewChat(userId, homeFolder);
    const ignoreMessagesBefore = Date.now();
    await imManager.disconnectUserChannel(userId, channel);

    const effectiveUserConfigs = resolveEffectiveImChannelConfigs({
      isAdmin: false,
      userConfigs: buildUserImChannelConfigMap(userId),
      globalConfigs: {},
    });
    const channelConfig = selectEffectiveImChannelConfig(
      effectiveUserConfigs,
      channel,
    );
    if (!channelConfig) {
      logger.info({ userId, channel }, 'User IM channel disabled via hot-reload');
      return false;
    }

    const connected = await imManager.connectUserChannel(
      userId,
      channel,
      channelConfig,
      onNewChat,
      { ignoreMessagesBefore },
    );
    logger.info({ userId, channel, connected }, 'User IM channel hot-reloaded');
    return connected;
  };

  // Start Web server early so frontend auth/API isn't blocked by Feishu readiness.
  startWebServer({
    queue,
    getRegisteredGroups: () => registeredGroups,
    getSessions: () => sessions,
    processGroupMessages,
    ensureTerminalContainerStarted,
    formatMessages,
    getLastAgentTimestamp: () => lastAgentTimestamp,
    setLastAgentTimestamp: (jid: string, cursor: MessageCursor) => {
      lastAgentTimestamp[jid] = cursor;
      saveState();
    },
    advanceGlobalCursor: (cursor: MessageCursor) => {
      if (isCursorAfter(cursor, globalMessageCursor)) {
        globalMessageCursor = cursor;
        saveState();
      }
    },
    reloadGlobalIMConfig,
    reloadUserIMConfig,
    getImChannelStatus: () => imManager.getAnyChannelStatuses(),
    getUserImChannelStatus: (userId: string) => imManager.getUserChannelStatuses(userId),
    processAgentConversation,
  });

  // Clean expired sessions every hour
  setInterval(
    () => {
      try {
        const deleted = deleteExpiredSessions();
        if (deleted > 0) {
          logger.info({ deleted }, 'Cleaned expired user sessions');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to clean expired sessions');
      }
    },
    60 * 60 * 1000,
  );

  // OAuth token auto-refresh (every 5 minutes)
  setInterval(async () => {
    try {
      const config = getRuntimeProviderConfigForRefresh();
      const creds = config.claudeOAuthCredentials;
      if (!creds) return;

      const timeToExpiry = creds.expiresAt - Date.now();
      if (timeToExpiry > 30 * 60 * 1000) return; // >30min to expiry, skip

      logger.info(
        { expiresIn: Math.round(timeToExpiry / 1000) },
        'OAuth token expiring soon, refreshing...',
      );
      const refreshed = await refreshOAuthCredentials(creds);
      if (refreshed) {
        const current = getRuntimeProviderConfigForRefresh();
        const saved = saveRuntimeProviderConfigForRefresh({
          ...current,
          claudeOAuthCredentials: refreshed,
        });
        updateAllSessionCredentials(saved);
        logger.info('OAuth token refreshed successfully');
      } else {
        logger.warn('OAuth token refresh failed');
      }
    } catch (err) {
      logger.error({ err }, 'OAuth auto-refresh error');
    }
  }, 5 * 60 * 1000);

  await ensureDockerRunning();

  queue.setProcessMessagesFn(processGroupMessages);
  queue.setHostModeChecker((groupJid: string) => {
    const group = getRegisteredGroupWithCache(groupJid);
    if (!group) return false;
    return resolveExecutionMode(groupJid, group) === 'host';
  });
  queue.setSerializationKeyResolver((groupJid: string) => {
    // Agent virtual JIDs: {chatJid}#agent:{agentId} → separate serialization key
    const agentSep = groupJid.indexOf('#agent:');
    if (agentSep >= 0) {
      const baseJid = groupJid.slice(0, agentSep);
      const agentId = groupJid.slice(agentSep + 7);
      const group = registeredGroups[baseJid];
      const folder = group?.folder || baseJid;
      return `${folder}#${agentId}`;
    }
    const group = registeredGroups[groupJid];
    return group?.folder || groupJid;
  });
  queue.setOnMaxRetriesExceeded((groupJid: string) => {
    const group = registeredGroups[groupJid];
    const name = group?.name || groupJid;
    sendSystemMessage(groupJid, 'agent_max_retries', `${name} 处理失败，已达最大重试次数`);
    setTyping(groupJid, false);
  });
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder, displayName) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder, displayName),
    sendMessage,
    assistantName: APP_NAME,
  });
  startIpcWatcher();
  recoverPendingMessages();
  startMessageLoop();

  // --- IM Connection Pool: connect per-user IM channels ---
  // Load global IM config (backward compat: used for admin if no per-user config exists)
  const globalConfigs = buildGlobalImChannelConfigMap();
  const hasGlobalFeishuConfigured = hasEnabledGlobalImChannelConfig(
    globalConfigs,
    'feishu',
  );

  // Paginate through all active users (listUsers caps at 200 per page)
  let allActiveUsers: typeof listUsers extends (...args: any) => { users: infer U } ? U : never = [];
  {
    let page = 1;
    while (true) {
      const result = listUsers({ status: 'active', page, pageSize: 200 });
      allActiveUsers = allActiveUsers.concat(result.users);
      if (allActiveUsers.length >= result.total) break;
      page++;
    }
  }

  // Register admin users for fallback IM routing
  for (const user of allActiveUsers) {
    if (user.role === 'admin') imManager.registerAdminUser(user.id);
  }

  let anyFeishuConnected = false;

  for (const user of allActiveUsers) {
    const homeGroup = getUserHomeGroup(user.id);
    if (!homeGroup) continue;

    // Per-user IM config takes precedence; fall back to global config for admin
    const effectiveConfigs = resolveEffectiveImChannelConfigs({
      isAdmin: user.role === 'admin',
      userConfigs: buildUserImChannelConfigMap(user.id),
      globalConfigs,
    });

    if (!hasAnyEffectiveImChannelConfig(effectiveConfigs)) continue;

    try {
      const result = await connectUserIMChannels(
        user.id,
        homeGroup.folder,
        effectiveConfigs,
      );
      if (result.feishu === true) anyFeishuConnected = true;
      logger.info(
        { userId: user.id, channels: result },
        'User IM channels connected',
      );
    } catch (err) {
      logger.error({ userId: user.id, err }, 'Failed to connect user IM channels');
    }
  }

  // Start Feishu group sync if any connection is active
  if (anyFeishuConnected) {
    syncGroupMetadata().catch((err) =>
      logger.error({ err }, 'Initial group sync failed'),
    );
    feishuSyncInterval = setInterval(() => {
      syncGroupMetadata().catch((err) =>
        logger.error({ err }, 'Periodic group sync failed'),
      );
    }, GROUP_SYNC_INTERVAL_MS);
  } else if (hasGlobalFeishuConfigured) {
    logger.warn(
      'Feishu is not connected. Configure credentials in Settings to enable Feishu sync.',
    );
  }
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start solomesh');
  process.exit(1);
});
