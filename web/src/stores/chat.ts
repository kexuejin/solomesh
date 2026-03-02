import { create } from 'zustand';
import { api } from '../api/client';
import { wsManager } from '../api/ws';
import { useFileStore } from './files';
import { useAuthStore } from './auth';
import { formatToolDisplayName } from '../lib/tool-display';
import type { GroupInfo, AgentInfo } from '../types';
import {
  isProviderDirectiveOnly,
  parseProviderDirectiveInput,
} from '../lib/provider-directive';
import {
  isWorkflowCommandOnly,
  parseWorkflowDirectiveInput,
} from '../lib/workflow-directive';
import { translateLocaleMessage } from '../i18n/runtime';
import { extractStoreErrorMessage } from './error-message';

export type { GroupInfo, AgentInfo };

export interface Message {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  attachments?: string;
  provider?: 'claude' | 'codex' | 'gemini' | null;
}

export type OperationPermissionMode = 'default' | 'bypass';

export interface QueuedOutgoingMessage {
  id: string;
  content: string;
  attachments?: Array<{ data: string; mimeType: string }>;
  operationPermissionMode?: OperationPermissionMode;
  createdAt: number;
}

// 流式事件类型定义
// ⚠️ 与 src/types.ts (后端) 和 container/agent-runner/src/index.ts 保持同步
export type StreamEventType =
  | 'text_delta' | 'thinking_delta'
  | 'tool_use_start' | 'tool_use_end' | 'tool_progress'
  | 'hook_started' | 'hook_progress' | 'hook_response'
  | 'task_start' | 'task_notification'
  | 'status' | 'init';

export interface StreamEvent {
  eventType: StreamEventType;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  parentToolUseId?: string | null;
  isNested?: boolean;
  skillName?: string;
  toolInputSummary?: string;
  elapsedSeconds?: number;
  hookName?: string;
  hookEvent?: string;
  hookOutcome?: string;
  statusText?: string;
  taskDescription?: string;
  taskId?: string;
  taskStatus?: string;
  taskSummary?: string;
}

export interface StreamingTimelineEvent {
  id: string;
  timestamp: number;
  text: string;
  kind: 'tool' | 'skill' | 'hook' | 'status';
}

export interface StreamingState {
  partialText: string;
  thinkingText: string;
  isThinking: boolean;
  activeTools: Array<{
    toolName: string;
    toolUseId: string;
    startTime: number;
    elapsedSeconds?: number;
    parentToolUseId?: string | null;
    isNested?: boolean;
    skillName?: string;
    toolInputSummary?: string;
  }>;
  activeHook: { hookName: string; hookEvent: string } | null;
  systemStatus: string | null;
  recentEvents: StreamingTimelineEvent[];
}

type ChatStoreMessageKey =
  | 'chat.store.stream.skillLabel'
  | 'chat.store.stream.toolLabel'
  | 'chat.store.stream.toolDone'
  | 'chat.store.stream.hookStarted'
  | 'chat.store.stream.hookEnded'
  | 'chat.store.stream.status'
  | 'chat.store.stream.unknown'
  | 'chat.store.stream.success'
  | 'chat.store.stream.taskFallback'
  | 'chat.store.errors.loadGroupsFailed'
  | 'chat.store.errors.loadMessagesFailed'
  | 'chat.store.errors.refreshMessagesFailed'
  | 'chat.store.errors.sendMessageFailed'
  | 'chat.store.errors.stopGroupFailed'
  | 'chat.store.errors.interruptFailed'
  | 'chat.store.errors.resetSessionFailed'
  | 'chat.store.errors.clearHistoryFailed'
  | 'chat.store.errors.createFlowFailed'
  | 'chat.store.errors.renameFlowFailed'
  | 'chat.store.errors.updateFlowDirectoryFailed'
  | 'chat.store.errors.deleteFlowFailed'
  | 'chat.store.errors.createConversationFailed'
  | 'chat.store.errors.loadAgentMessagesFailed'
  | 'chat.store.errors.refreshAgentMessagesFailed';

function chatStoreText(
  key: ChatStoreMessageKey,
  params?: Record<string, string | number>,
): string {
  return translateLocaleMessage(key, params);
}

function chatStoreError(err: unknown, fallbackKey: ChatStoreMessageKey): string {
  return extractStoreErrorMessage(err) ?? chatStoreText(fallbackKey);
}

function mergeMessagesChronologically(
  existing: Message[],
  incoming: Message[],
): Message[] {
  const byId = new Map<string, Message>();
  for (const m of existing) byId.set(m.id, m);
  // Incoming messages are authoritative, but preserve reference if content unchanged
  for (const m of incoming) {
    const old = byId.get(m.id);
    if (!old || old.content !== m.content || old.timestamp !== m.timestamp) {
      byId.set(m.id, m);
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    if (a.timestamp === b.timestamp) return a.id.localeCompare(b.id);
    return a.timestamp.localeCompare(b.timestamp);
  });
}

const MAX_THINKING_CACHE_SIZE = 500;

/** Evict oldest entries when cache exceeds capacity (relies on insertion order) */
function capThinkingCache(cache: Record<string, string>): Record<string, string> {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_THINKING_CACHE_SIZE) return cache;
  const keep = keys.slice(keys.length - MAX_THINKING_CACHE_SIZE);
  const next: Record<string, string> = {};
  for (const k of keep) next[k] = cache[k];
  return next;
}

function retainThinkingCacheForMessages(
  messagesByGroup: Record<string, Message[]>,
  cache: Record<string, string>,
): Record<string, string> {
  const aliveMessageIds = new Set<string>();
  for (const messages of Object.values(messagesByGroup)) {
    for (const m of messages) aliveMessageIds.add(m.id);
  }

  const next: Record<string, string> = {};
  for (const [messageId, content] of Object.entries(cache)) {
    if (aliveMessageIds.has(messageId)) next[messageId] = content;
  }
  return capThinkingCache(next);
}

function shouldWaitForReplyFromLatestMessage(
  latest: Message | null,
): boolean {
  if (!latest) return false;
  if (latest.sender === '__system__') return false;
  if (latest.is_from_me) return false;
  if (isProviderDirectiveOnly(latest.content)) return false;
  if (isWorkflowCommandOnly(latest.content)) return false;
  return true;
}

function getDirectiveProvider(
  content: string,
): 'claude' | 'codex' | 'gemini' | null {
  return parseProviderDirectiveInput(content).provider;
}

function isStreamTerminalStatus(statusText: string | undefined): boolean {
  return statusText === 'interrupted' || statusText === 'completed_no_output';
}

function isTerminalSystemMessage(content: string): boolean {
  return (
    content.startsWith('agent_error:')
    || content.startsWith('agent_max_retries:')
    || content.startsWith('context_overflow:')
    || content.startsWith('workflow_dependency_blocked:')
    || content.startsWith('workflow_template_edit:')
    || content === 'query_interrupted'
  );
}

function createQueuedMessage(
  content: string,
  attachments?: Array<{ data: string; mimeType: string }>,
  operationPermissionMode?: OperationPermissionMode,
): QueuedOutgoingMessage {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    content,
    attachments: attachments && attachments.length > 0
      ? attachments.map((att) => ({ ...att }))
      : undefined,
    operationPermissionMode,
    createdAt: Date.now(),
  };
}

function isMainConversationBusy(state: ChatState, jid: string): boolean {
  return !!state.waiting[jid] || !!state.streaming[jid];
}

function isAgentConversationBusy(state: ChatState, agentId: string): boolean {
  return !!state.agentWaiting[agentId] || !!state.agentStreaming[agentId];
}

interface ChatState {
  groups: Record<string, GroupInfo>;
  currentGroup: string | null;
  messages: Record<string, Message[]>;
  waiting: Record<string, boolean>;
  hasMore: Record<string, boolean>;
  loading: boolean;
  error: string | null;
  streaming: Record<string, StreamingState>;
  thinkingCache: Record<string, string>;
  pendingThinking: Record<string, string>;
  queuedMainMessages: Record<string, QueuedOutgoingMessage[]>;
  queuedAgentMessages: Record<string, QueuedOutgoingMessage[]>;
  sendingQueuedMain: Record<string, boolean>;
  sendingQueuedAgent: Record<string, boolean>;
  /** Per-group lock: true while clearHistory is in-flight, prevents race re-injection */
  clearing: Record<string, boolean>;
  // Sub-agent state
  agents: Record<string, AgentInfo[]>;              // jid → agents
  agentStreaming: Record<string, StreamingState>;    // agentId → streaming state
  activeAgentTab: Record<string, string | null>;     // jid → selected agentId (null = main)
  // SDK Task subagent state (in-process via Task tool, not DB-persisted)
  sdkTasks: Record<string, {  // toolUseId → task info
    chatJid: string;
    description: string;
    status: 'running' | 'completed' | 'error';
    summary?: string;
    isTeammate?: boolean;
    startedAt?: number;
  }>;
  // SDK Task alias map: runtime taskId/parentToolUseId -> canonical sdkTasks key
  sdkTaskAliases: Record<string, string>;
  // Conversation agent state
  agentMessages: Record<string, Message[]>;          // agentId → messages
  agentWaiting: Record<string, boolean>;             // agentId → waiting for reply
  agentHasMore: Record<string, boolean>;             // agentId → has more messages
  agentCurrentProvider: Record<string, 'claude' | 'codex' | 'gemini'>; // agentId → current provider
  loadGroups: () => Promise<void>;
  selectGroup: (jid: string) => void;
  loadMessages: (jid: string, loadMore?: boolean) => Promise<void>;
  refreshMessages: (jid: string) => Promise<void>;
  sendMessage: (
    jid: string,
    content: string,
    attachments?: Array<{ data: string; mimeType: string }>,
    operationPermissionMode?: OperationPermissionMode,
  ) => Promise<void>;
  sendMessageNow: (
    jid: string,
    content: string,
    attachments?: Array<{ data: string; mimeType: string }>,
    operationPermissionMode?: OperationPermissionMode,
  ) => Promise<void>;
  flushQueuedMainMessages: (jid: string) => Promise<void>;
  removeQueuedMainMessage: (jid: string, queuedMessageId: string) => void;
  clearQueuedMainMessages: (jid: string) => void;
  stopGroup: (jid: string) => Promise<boolean>;
  interruptQuery: (jid: string) => Promise<boolean>;
  resetSession: (jid: string) => Promise<boolean>;
  clearHistory: (jid: string) => Promise<boolean>;
  createFlow: (name: string, options?: { execution_mode?: 'container' | 'host'; custom_cwd?: string; init_source_path?: string; init_git_url?: string }) => Promise<{ jid: string; folder: string } | null>;
  renameFlow: (jid: string, name: string) => Promise<void>;
  updateFlowDirectory: (jid: string, customCwd: string | null) => Promise<boolean>;
  deleteFlow: (jid: string) => Promise<void>;
  handleStreamEvent: (chatJid: string, event: StreamEvent, agentId?: string) => void;
  handleWsNewMessage: (chatJid: string, wsMsg: any, agentId?: string) => void;
  handleAgentStatus: (chatJid: string, agentId: string, status: AgentInfo['status'], name: string, prompt: string, resultSummary?: string, kind?: AgentInfo['kind']) => void;
  clearStreaming: (
    chatJid: string,
    options?: { preserveThinking?: boolean },
  ) => void;
  restoreActiveState: () => Promise<void>;
  // Sub-agent actions
  loadAgents: (jid: string) => Promise<void>;
  deleteAgentAction: (jid: string, agentId: string) => Promise<boolean>;
  setActiveAgentTab: (jid: string, agentId: string | null) => void;
  // Conversation agent actions
  createConversation: (jid: string, name: string, description?: string) => Promise<AgentInfo | null>;
  loadAgentMessages: (jid: string, agentId: string, loadMore?: boolean) => Promise<void>;
  sendAgentMessage: (
    jid: string,
    agentId: string,
    content: string,
    operationPermissionMode?: OperationPermissionMode,
  ) => void;
  sendAgentMessageNow: (
    jid: string,
    agentId: string,
    content: string,
    operationPermissionMode?: OperationPermissionMode,
  ) => void;
  flushQueuedAgentMessages: (jid: string, agentId: string) => Promise<void>;
  removeQueuedAgentMessage: (agentId: string, queuedMessageId: string) => void;
  clearQueuedAgentMessages: (agentId: string) => void;
  refreshAgentMessages: (jid: string, agentId: string) => Promise<void>;
}

const DEFAULT_STREAMING_STATE: StreamingState = {
  partialText: '', thinkingText: '', isThinking: false,
  activeTools: [], activeHook: null, systemStatus: null, recentEvents: [],
};

const MAX_EVENT_LOG = 30;
const SDK_TASK_AUTO_CLOSE_MS = 3000;
const SDK_TASK_TOOL_END_FALLBACK_CLOSE_MS = 1200;
const sdkTaskCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function removeSdkTaskAliases(
  aliases: Record<string, string>,
  taskId: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [alias, target] of Object.entries(aliases)) {
    if (alias === taskId || target === taskId) continue;
    next[alias] = target;
  }
  return next;
}

function resolveSdkTaskId(
  state: Pick<ChatState, 'sdkTasks' | 'sdkTaskAliases'>,
  rawId: string,
): string {
  if (state.sdkTasks[rawId]) return rawId;
  return state.sdkTaskAliases[rawId] || rawId;
}

function pickSdkTaskAliasTarget(
  state: Pick<ChatState, 'sdkTasks' | 'sdkTaskAliases' | 'agents'>,
  chatJid: string,
): string | null {
  const runningIds = Object.entries(state.sdkTasks)
    .filter(([, task]) => task.chatJid === chatJid && task.status === 'running')
    .map(([id]) => id);
  if (runningIds.length === 0) return null;

  const usedTargets = new Set(Object.values(state.sdkTaskAliases));
  const unbound = runningIds.filter((id) => !usedTargets.has(id));
  const pool = (unbound.length > 0 ? unbound : runningIds).slice();
  const createdAtMap = new Map((state.agents[chatJid] || []).map((a) => [a.id, a.created_at]));
  pool.sort((a, b) => (createdAtMap.get(a) || '').localeCompare(createdAtMap.get(b) || ''));
  return pool[0] || null;
}

function clearSdkTaskCleanupTimer(taskId: string): void {
  const timer = sdkTaskCleanupTimers.get(taskId);
  if (timer) {
    clearTimeout(timer);
    sdkTaskCleanupTimers.delete(taskId);
  }
}

function scheduleSdkTaskCleanup(
  set: (fn: (s: ChatState) => Partial<ChatState>) => void,
  taskId: string,
  chatJid: string,
  delayMs = SDK_TASK_AUTO_CLOSE_MS,
): void {
  clearSdkTaskCleanupTimer(taskId);
  const timer = setTimeout(() => {
    sdkTaskCleanupTimers.delete(taskId);
    set((s) => {
      const nextSdkTasks = { ...s.sdkTasks };
      delete nextSdkTasks[taskId];
      const nextStreaming = { ...s.agentStreaming };
      delete nextStreaming[taskId];
      const nextActiveTab = { ...s.activeAgentTab };
      if (nextActiveTab[chatJid] === taskId) nextActiveTab[chatJid] = null;
      const nextAliases = removeSdkTaskAliases(s.sdkTaskAliases, taskId);
      return {
        sdkTasks: nextSdkTasks,
        sdkTaskAliases: nextAliases,
        agents: { ...s.agents, [chatJid]: (s.agents[chatJid] || []).filter(a => a.id !== taskId) },
        agentStreaming: nextStreaming,
        activeAgentTab: nextActiveTab,
      };
    });
  }, delayMs);
  sdkTaskCleanupTimers.set(taskId, timer);
}

function pushEvent(
  events: StreamingTimelineEvent[],
  kind: StreamingTimelineEvent['kind'],
  text: string,
): StreamingTimelineEvent[] {
  const item: StreamingTimelineEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    kind,
    text,
  };
  return [...events, item].slice(-MAX_EVENT_LOG);
}

/**
 * Apply a single StreamEvent to a StreamingState object.
 * Shared by main conversation and SDK subagent streaming.
 */
function applyStreamEvent(
  event: StreamEvent,
  prev: StreamingState,
  next: StreamingState,
  maxText: number,
): void {
  const unknownLabel = chatStoreText('chat.store.stream.unknown');
  const successLabel = chatStoreText('chat.store.stream.success');
  switch (event.eventType) {
    case 'text_delta': {
      const combined = prev.partialText + (event.text || '');
      next.partialText = combined.length > maxText ? combined.slice(-maxText) : combined;
      next.isThinking = false;
      break;
    }
    case 'thinking_delta': {
      const combined = prev.thinkingText + (event.text || '');
      next.thinkingText = combined.length > maxText ? combined.slice(-maxText) : combined;
      next.isThinking = true;
      break;
    }
    case 'tool_use_start': {
      next.isThinking = false;
      const toolUseId = event.toolUseId || '';
      const existing = prev.activeTools.find(t => t.toolUseId === toolUseId && toolUseId);
      const tool = {
        toolName: event.toolName || unknownLabel,
        toolUseId,
        startTime: Date.now(),
        parentToolUseId: event.parentToolUseId,
        isNested: event.isNested,
        skillName: event.skillName,
        toolInputSummary: event.toolInputSummary,
      };
      next.activeTools = existing
        ? prev.activeTools.map(t => (t.toolUseId === toolUseId ? { ...t, ...tool } : t))
        : [...prev.activeTools, tool];

      const isSkill = tool.toolName === 'Skill';
      const label = isSkill
        ? chatStoreText('chat.store.stream.skillLabel', { name: tool.skillName || unknownLabel })
        : chatStoreText('chat.store.stream.toolLabel', {
            name: formatToolDisplayName(tool.toolName),
          });
      const detail = tool.toolInputSummary ? ` (${tool.toolInputSummary})` : '';
      next.recentEvents = pushEvent(prev.recentEvents, isSkill ? 'skill' : 'tool', `${label}${detail}`);
      break;
    }
    case 'tool_use_end':
      if (event.toolUseId) {
        const ended = prev.activeTools.find(t => t.toolUseId === event.toolUseId);
        next.activeTools = prev.activeTools.filter(t => t.toolUseId !== event.toolUseId);
        if (ended) {
          const rawSec = (Date.now() - ended.startTime) / 1000;
          const elapsedSec = rawSec % 1 === 0 ? rawSec.toFixed(0) : rawSec.toFixed(1);
          const isSkill = ended.toolName === 'Skill';
          const label = isSkill
            ? chatStoreText('chat.store.stream.skillLabel', { name: ended.skillName || unknownLabel })
            : chatStoreText('chat.store.stream.toolLabel', {
                name: formatToolDisplayName(ended.toolName),
              });
          next.recentEvents = pushEvent(
            prev.recentEvents,
            isSkill ? 'skill' : 'tool',
            chatStoreText('chat.store.stream.toolDone', {
              label,
              elapsed: elapsedSec,
            }),
          );
        }
      } else {
        next.activeTools = [];
      }
      break;
    case 'tool_progress': {
      const existing = prev.activeTools.find(t => t.toolUseId === event.toolUseId);
      if (existing) {
        const skillNameResolved = event.skillName && !existing.skillName;
        next.activeTools = prev.activeTools.map(t =>
          t.toolUseId === event.toolUseId
            ? {
                ...t,
                elapsedSeconds: event.elapsedSeconds,
                ...(event.skillName ? { skillName: event.skillName } : {}),
              }
            : t
        );
        if (skillNameResolved) {
          const oldLabel = chatStoreText('chat.store.stream.skillLabel', { name: unknownLabel });
          const newLabel = chatStoreText('chat.store.stream.skillLabel', { name: event.skillName || unknownLabel });
          next.recentEvents = prev.recentEvents.map(e =>
            e.kind === 'skill' && e.text.includes(oldLabel)
              ? { ...e, text: e.text.replace(oldLabel, newLabel) }
              : e
          );
        }
      } else {
        next.activeTools = [...prev.activeTools, {
          toolName: event.toolName || unknownLabel,
          toolUseId: event.toolUseId || '',
          startTime: Date.now(),
          parentToolUseId: event.parentToolUseId,
          isNested: event.isNested,
          elapsedSeconds: event.elapsedSeconds,
        }];
      }
      break;
    }
    case 'hook_started':
      next.activeHook = { hookName: event.hookName || '', hookEvent: event.hookEvent || '' };
      next.recentEvents = pushEvent(
        prev.recentEvents,
        'hook',
        chatStoreText('chat.store.stream.hookStarted', {
          hook: event.hookName || unknownLabel,
          event: event.hookEvent || unknownLabel,
        }),
      );
      break;
    case 'hook_progress':
      next.activeHook = { hookName: event.hookName || '', hookEvent: event.hookEvent || '' };
      break;
    case 'hook_response':
      next.activeHook = null;
      next.recentEvents = pushEvent(
        prev.recentEvents,
        'hook',
        chatStoreText('chat.store.stream.hookEnded', {
          hook: event.hookName || unknownLabel,
          outcome: event.hookOutcome || successLabel,
        }),
      );
      break;
    case 'status': {
      next.systemStatus = event.statusText || null;
      if (event.statusText) {
        next.recentEvents = pushEvent(
          prev.recentEvents,
          'status',
          chatStoreText('chat.store.stream.status', { text: event.statusText }),
        );
      }
      break;
    }
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  groups: {},
  currentGroup: null,
  messages: {},
  waiting: {},
  hasMore: {},
  loading: false,
  error: null,
  streaming: {},
  thinkingCache: {},
  pendingThinking: {},
  queuedMainMessages: {},
  queuedAgentMessages: {},
  sendingQueuedMain: {},
  sendingQueuedAgent: {},
  clearing: {},
  agents: {},
  agentStreaming: {},
  activeAgentTab: {},
  sdkTasks: {},
  sdkTaskAliases: {},
  agentMessages: {},
  agentWaiting: {},
  agentHasMore: {},
  agentCurrentProvider: {},

  loadGroups: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ groups: Record<string, GroupInfo> }>('/api/groups');
      set((state) => {
        const currentStillExists =
          state.currentGroup && !!data.groups[state.currentGroup];

        let nextCurrent = currentStillExists ? state.currentGroup : null;
        if (!nextCurrent) {
          const homeEntry = Object.entries(data.groups).find(
            ([_, group]) => group.is_my_home,
          );
          if (homeEntry) {
            nextCurrent = homeEntry[0];
          } else {
            nextCurrent = Object.keys(data.groups)[0] || null;
          }
        }

        return {
          groups: data.groups,
          currentGroup: nextCurrent,
          loading: false,
          error: null,
        };
      });
    } catch (err) {
      set({
        loading: false,
        error: chatStoreError(err, 'chat.store.errors.loadGroupsFailed'),
      });
    }
  },

  selectGroup: (jid: string) => {
    set({ currentGroup: jid });
    const state = get();
    if (!state.messages[jid]) {
      get().loadMessages(jid);
    }
  },

  loadMessages: async (jid: string, loadMore = false) => {
    const state = get();
    const existing = state.messages[jid] || [];
    const before = loadMore && existing.length > 0 ? existing[0].timestamp : undefined;

    try {
      const data = await api.get<{ messages: Message[]; hasMore: boolean }>(
        `/api/groups/${encodeURIComponent(jid)}/messages?${new URLSearchParams(
          before ? { before: String(before), limit: '50' } : { limit: '50' }
        )}`
      );
      // Messages come in DESC order from API, reverse to chronological for display
      const sorted = [...data.messages].reverse();
      set((s) => {
        const merged = mergeMessagesChronologically(s.messages[jid] || [], sorted);
        const latest = merged.length > 0 ? merged[merged.length - 1] : null;
        const shouldWait = shouldWaitForReplyFromLatestMessage(latest);
        const nextWaiting = { ...s.waiting };
        if (shouldWait) {
          nextWaiting[jid] = true;
        } else {
          delete nextWaiting[jid];
        }

        return {
          messages: {
            ...s.messages,
            [jid]: merged,
          },
          waiting: nextWaiting,
          hasMore: { ...s.hasMore, [jid]: data.hasMore },
          error: null,
        };
      });
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.loadMessagesFailed') });
    }
  },

  refreshMessages: async (jid: string) => {
    // Skip polling while clearHistory is in-flight to prevent race re-injection
    if (get().clearing[jid]) return;

    const state = get();
    const existing = state.messages[jid] || [];
    const lastMessage = existing.length > 0 ? existing[existing.length - 1] : undefined;

    try {
      // Fetch messages newer than the last one we have
      const params = new URLSearchParams({ limit: '50' });
      if (lastMessage?.timestamp) {
        params.set('after', lastMessage.timestamp);
      }
      if (lastMessage?.id) {
        params.set('afterId', lastMessage.id);
      }

      const data = await api.get<{ messages: Message[] }>(
        `/api/groups/${encodeURIComponent(jid)}/messages?${params}`
      );

      // Re-check clearing lock after async fetch — clearHistory may have started mid-request
      if (get().clearing[jid]) return;

      if (data.messages.length > 0) {
        // Messages from getMessagesAfter are already in ASC order
        set((s) => {
          const merged = mergeMessagesChronologically(
            s.messages[jid] || [],
            data.messages,
          );
          // Check if agent has replied (any new message with is_from_me=true)
          const agentReplied = data.messages.some(
            (m) => m.is_from_me && m.sender !== '__system__',
          );
          const hasSystemError = data.messages.some(
            (m) => m.sender === '__system__' &&
              isTerminalSystemMessage(m.content)
          );

          // Transfer pending thinking to thinkingCache
          let nextThinkingCache = s.thinkingCache;
          let nextPendingThinking = s.pendingThinking;
          if (agentReplied && s.pendingThinking[jid]) {
            const lastAiMsg = [...data.messages]
              .reverse()
              .find((m) => m.is_from_me && m.sender !== '__system__');
            if (lastAiMsg) {
              nextThinkingCache = capThinkingCache({ ...s.thinkingCache, [lastAiMsg.id]: s.pendingThinking[jid] });
              const { [jid]: _, ...restPending } = s.pendingThinking;
              nextPendingThinking = restPending;
            }
          }

          return {
            messages: { ...s.messages, [jid]: merged },
            waiting: (agentReplied || hasSystemError)
              ? { ...s.waiting, [jid]: false }
              : s.waiting,
            streaming: (agentReplied || hasSystemError)
              ? (() => { const next = { ...s.streaming }; delete next[jid]; return next; })()
              : s.streaming,
            thinkingCache: nextThinkingCache,
            pendingThinking: nextPendingThinking,
            error: null,
          };
        });
      }
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.refreshMessagesFailed') });
    }
  },

  sendMessageNow: async (
    jid: string,
    content: string,
    attachments?: Array<{ data: string; mimeType: string }>,
    operationPermissionMode?: OperationPermissionMode,
  ) => {
    try {
      set((s) => {
        const next = { ...s.streaming };
        delete next[jid];
        return { streaming: next };
      });

      const body: {
        chatJid: string;
        content: string;
        attachments?: Array<{ type: 'image'; data: string; mimeType: string }>;
        operationPermissionMode?: OperationPermissionMode;
      } = { chatJid: jid, content };
      if (attachments && attachments.length > 0) {
        body.attachments = attachments.map(att => ({ type: 'image', ...att }));
      }
      if (operationPermissionMode) {
        body.operationPermissionMode = operationPermissionMode;
      }

      const data = await api.post<{ success: boolean; messageId: string; timestamp: string }>('/api/messages', body);
      if (data.success) {
        // Add user message to local state immediately
        const authState = useAuthStore.getState();
        const sender = authState.user?.id || 'web-user';
        const senderName = authState.user?.display_name || authState.user?.username || 'Web';
        const msg: Message = {
          id: data.messageId,
          chat_jid: jid,
          sender,
          sender_name: senderName,
          content,
          // Use server timestamp so incremental polling cursor stays monotonic with backend data.
          timestamp: data.timestamp,
          // is_from_me is from the bot's perspective: true = bot sent it, false = human sent it
          is_from_me: false,
          attachments: body.attachments ? JSON.stringify(body.attachments) : undefined,
          provider: null,
        };
        const workflowDirective = parseWorkflowDirectiveInput(content);
        const shouldWaitForReply =
          ((!isProviderDirectiveOnly(content) && !workflowDirective.isCommandOnly)
            || (attachments?.length ?? 0) > 0);
        const directiveProvider = getDirectiveProvider(content);
        set((s) => ({
          groups:
            directiveProvider && s.groups[jid]
              ? {
                  ...s.groups,
                  [jid]: {
                    ...s.groups[jid],
                    effective_provider: directiveProvider,
                  },
                }
              : s.groups,
          ...(() => {
            const nextWaiting = { ...s.waiting };
            if (shouldWaitForReply) {
              nextWaiting[jid] = true;
            } else {
              delete nextWaiting[jid];
            }
            return { waiting: nextWaiting };
          })(),
          messages: {
            ...s.messages,
            [jid]: (s.messages[jid] || []).some((m) => m.id === msg.id)
              ? (s.messages[jid] || [])
              : [...(s.messages[jid] || []), msg],
          },
          error: null,
        }));
        if (workflowDirective.hasCommand) {
          await Promise.all([
            get().loadGroups(),
            get().refreshMessages(jid),
          ]);
        }
      }
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.sendMessageFailed') });
    }
  },

  sendMessage: async (
    jid: string,
    content: string,
    attachments?: Array<{ data: string; mimeType: string }>,
    operationPermissionMode?: OperationPermissionMode,
  ) => {
    const state = get();
    const queued = state.queuedMainMessages[jid] || [];
    if (
      isMainConversationBusy(state, jid) ||
      queued.length > 0 ||
      !!state.sendingQueuedMain[jid]
    ) {
      const queuedMessage = createQueuedMessage(
        content,
        attachments,
        operationPermissionMode,
      );
      set((s) => ({
        queuedMainMessages: {
          ...s.queuedMainMessages,
          [jid]: [...(s.queuedMainMessages[jid] || []), queuedMessage],
        },
      }));
      return;
    }
    await get().sendMessageNow(
      jid,
      content,
      attachments,
      operationPermissionMode,
    );
  },

  flushQueuedMainMessages: async (jid: string) => {
    const state = get();
    if (state.sendingQueuedMain[jid] || isMainConversationBusy(state, jid)) return;
    const queue = state.queuedMainMessages[jid] || [];
    if (queue.length === 0) return;

    const [next, ...rest] = queue;
    set((s) => ({
      queuedMainMessages: {
        ...s.queuedMainMessages,
        [jid]: rest,
      },
      sendingQueuedMain: {
        ...s.sendingQueuedMain,
        [jid]: true,
      },
    }));

    try {
      await get().sendMessageNow(
        jid,
        next.content,
        next.attachments,
        next.operationPermissionMode,
      );
    } finally {
      set((s) => ({
        sendingQueuedMain: {
          ...s.sendingQueuedMain,
          [jid]: false,
        },
      }));
    }
  },

  removeQueuedMainMessage: (jid: string, queuedMessageId: string) => {
    set((s) => ({
      queuedMainMessages: {
        ...s.queuedMainMessages,
        [jid]: (s.queuedMainMessages[jid] || []).filter((m) => m.id !== queuedMessageId),
      },
    }));
  },

  clearQueuedMainMessages: (jid: string) => {
    set((s) => ({
      queuedMainMessages: {
        ...s.queuedMainMessages,
        [jid]: [],
      },
    }));
  },

  stopGroup: async (jid: string) => {
    try {
      await api.post<{ success: boolean }>(
        `/api/groups/${encodeURIComponent(jid)}/stop`,
      );
      get().clearStreaming(jid, { preserveThinking: false });
      set((s) => {
        const next = { ...s.waiting };
        delete next[jid];
        return { waiting: next };
      });
      return true;
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.stopGroupFailed') });
      return false;
    }
  },

  interruptQuery: async (jid: string) => {
    try {
      const data = await api.post<{ success: boolean; interrupted: boolean }>(
        `/api/groups/${encodeURIComponent(jid)}/interrupt`,
      );
      if (!data.interrupted) {
        // Stale waiting fallback: even without an active runner, user explicitly
        // requested interruption, so clear local waiting/streaming state.
        get().clearStreaming(jid, { preserveThinking: false });
        set((s) => {
          const nextWaiting = { ...s.waiting };
          delete nextWaiting[jid];
          return { waiting: nextWaiting, error: null };
        });
        await get().refreshMessages(jid);
        return false;
      }

      get().clearStreaming(jid, { preserveThinking: false });
      set((s) => {
        const next = { ...s.waiting };
        delete next[jid];
        return { waiting: next };
      });
      return true;
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.interruptFailed') });
      return false;
    }
  },

  resetSession: async (jid: string) => {
    try {
      await api.post<{ success: boolean; dividerMessageId: string }>(
        `/api/groups/${encodeURIComponent(jid)}/reset-session`,
      );
      get().clearStreaming(jid, { preserveThinking: false });
      // Refresh messages to pick up the divider message
      await get().refreshMessages(jid);
      return true;
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.resetSessionFailed') });
      return false;
    }
  },

  clearHistory: async (jid: string) => {
    // Set clearing lock BEFORE the API call to block polling & WS injection
    set((s) => ({ clearing: { ...s.clearing, [jid]: true } }));

    try {
      await api.post<{ success: boolean }>(
        `/api/groups/${encodeURIComponent(jid)}/clear-history`,
      );

      set((s) => {
        // Delete the key entirely (not []==[]) so selectGroup/ChatView effect
        // will trigger loadMessages on re-entry
        const nextMessages = { ...s.messages };
        delete nextMessages[jid];
        const nextStreaming = { ...s.streaming };
        delete nextStreaming[jid];
        const { [jid]: _pending, ...nextPendingThinking } = s.pendingThinking;
        const { [jid]: _clearing, ...nextClearing } = s.clearing;
        const nextQueuedMainMessages = { ...s.queuedMainMessages, [jid]: [] };
        const nextSendingQueuedMain = { ...s.sendingQueuedMain };
        delete nextSendingQueuedMain[jid];

        return {
          messages: nextMessages,
          waiting: { ...s.waiting, [jid]: false },
          hasMore: { ...s.hasMore, [jid]: false },
          streaming: nextStreaming,
          pendingThinking: nextPendingThinking,
          queuedMainMessages: nextQueuedMainMessages,
          sendingQueuedMain: nextSendingQueuedMain,
          clearing: nextClearing,
          thinkingCache: retainThinkingCacheForMessages(
            nextMessages,
            s.thinkingCache,
          ),
          error: null,
        };
      });

      await get().loadGroups();
      // 重建工作区后刷新文件列表（工作目录已被清空）
      useFileStore.getState().loadFiles(jid);
      return true;
    } catch (err) {
      // Release clearing lock on failure
      set((s) => {
        const { [jid]: _, ...nextClearing } = s.clearing;
        return {
          clearing: nextClearing,
          error: chatStoreError(err, 'chat.store.errors.clearHistoryFailed'),
        };
      });
      return false;
    }
  },

  createFlow: async (name: string, options?: { execution_mode?: 'container' | 'host'; custom_cwd?: string; init_source_path?: string; init_git_url?: string }) => {
    try {
      const body: Record<string, string> = { name };
      if (options?.execution_mode) body.execution_mode = options.execution_mode;
      if (options?.custom_cwd) body.custom_cwd = options.custom_cwd;
      if (options?.init_source_path) body.init_source_path = options.init_source_path;
      if (options?.init_git_url) body.init_git_url = options.init_git_url;

      const needsLongTimeout = !!(options?.init_source_path || options?.init_git_url);
      const data = await api.post<{
        success: boolean;
        jid: string;
        group: GroupInfo;
      }>('/api/groups', body, needsLongTimeout ? 120_000 : undefined);
      if (!data.success) return null;

      set((s) => ({
        groups: { ...s.groups, [data.jid]: data.group },
        error: null,
      }));

      return { jid: data.jid, folder: data.group.folder };
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.createFlowFailed') });
      return null;
    }
  },

  renameFlow: async (jid: string, name: string) => {
    try {
      await api.patch<{ success: boolean }>(`/api/groups/${encodeURIComponent(jid)}`, { name });
      set((s) => {
        const group = s.groups[jid];
        if (!group) return s;
        return {
          groups: {
            ...s.groups,
            [jid]: {
              ...group,
              name,
            },
          },
          error: null,
        };
      });
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.renameFlowFailed') });
    }
  },

  updateFlowDirectory: async (jid: string, customCwd: string | null) => {
    try {
      await api.patch<{ success: boolean }>(`/api/groups/${encodeURIComponent(jid)}`, {
        custom_cwd: customCwd,
      });
      await get().loadGroups();
      set({ error: null });
      return true;
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.updateFlowDirectoryFailed') });
      return false;
    }
  },

  deleteFlow: async (jid: string) => {
    try {
      await api.delete<{ success: boolean }>(`/api/groups/${encodeURIComponent(jid)}`);
      set((s) => {
        const nextGroups = { ...s.groups };
        const nextMessages = { ...s.messages };
        const nextWaiting = { ...s.waiting };
        const nextHasMore = { ...s.hasMore };
        const nextStreaming = { ...s.streaming };
        const nextPendingThinking = { ...s.pendingThinking };

        delete nextGroups[jid];
        delete nextMessages[jid];
        delete nextWaiting[jid];
        delete nextHasMore[jid];
        delete nextStreaming[jid];
        delete nextPendingThinking[jid];

        let nextCurrent = s.currentGroup === jid ? null : s.currentGroup;
        // Auto-select first remaining group after deletion
        if (nextCurrent === null) {
          const remainingJids = Object.keys(nextGroups);
          nextCurrent = remainingJids.length > 0 ? remainingJids[0] : null;
        }

        return {
          groups: nextGroups,
          messages: nextMessages,
          waiting: nextWaiting,
          hasMore: nextHasMore,
          streaming: nextStreaming,
          pendingThinking: nextPendingThinking,
          thinkingCache: retainThinkingCacheForMessages(
            nextMessages,
            s.thinkingCache,
          ),
          currentGroup: nextCurrent,
          error: null,
        };
      });
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.deleteFlowFailed') });
    }
  },

  // 处理流式事件
  handleStreamEvent: (chatJid, event, agentId?) => {
    // Skip while clearHistory is in-flight
    if (get().clearing[chatJid]) return;

    // ① conversation agent（DB 持久化的）— 已有逻辑不变
    if (agentId) {
      if (event.eventType === 'status' && isStreamTerminalStatus(event.statusText)) {
        set((s) => {
          const next = { ...s.agentStreaming };
          delete next[agentId];
          const nextWaiting = { ...s.agentWaiting };
          delete nextWaiting[agentId];
          return { agentStreaming: next, agentWaiting: nextWaiting };
        });
        return;
      }
      set((s) => {
        const prev = s.agentStreaming[agentId] || { ...DEFAULT_STREAMING_STATE };
        const next = { ...prev };
        applyStreamEvent(event, prev, next, 8000);
        return { agentStreaming: { ...s.agentStreaming, [agentId]: next } };
      });
      return;
    }

    const defaultTaskLabel = chatStoreText('chat.store.stream.taskFallback');

    const ensureSdkTask = (taskId: string, description?: string) => {
      set((s) => {
        const existingTask = s.sdkTasks[taskId];
        const desc = description || existingTask?.description || defaultTaskLabel;
        const agents = s.agents[chatJid] || [];
        const idx = agents.findIndex(a => a.id === taskId);
        const nextAgent: AgentInfo = {
          id: taskId,
          name: desc.slice(0, 40),
          prompt: desc,
          status: 'running',
          kind: 'task',
          created_at: idx >= 0 ? agents[idx].created_at : new Date().toISOString(),
        };
        const updatedAgents = idx >= 0
          ? agents.map((a, i) => (i === idx ? { ...a, ...nextAgent } : a))
          : [...agents, nextAgent];

        return {
          sdkTasks: {
            ...s.sdkTasks,
            [taskId]: {
              chatJid,
              description: desc,
              status: 'running',
              summary: existingTask?.summary,
            },
          },
          agents: { ...s.agents, [chatJid]: updatedAgents },
        };
      });
    };

    const resolveOrBindTaskId = (rawId: string): string => {
      const state = get();
      const resolved = resolveSdkTaskId(state, rawId);
      if (state.sdkTasks[resolved]) return resolved;
      const target = pickSdkTaskAliasTarget(state, chatJid);
      if (target && rawId !== target) {
        set((s) => ({ sdkTaskAliases: { ...s.sdkTaskAliases, [rawId]: target } }));
        return target;
      }
      return resolved;
    };

    const finalizeSdkTask = (
      taskId: string,
      status: 'completed' | 'error',
      summary?: string,
      closeAfterMs = SDK_TASK_AUTO_CLOSE_MS,
    ) => {
      let targetChatJid: string | null = null;
      set((s) => {
        const existingTask = s.sdkTasks[taskId];
        const taskChatJid = existingTask?.chatJid || chatJid;
        const agents = s.agents[taskChatJid] || [];
        const idx = agents.findIndex(a => a.id === taskId && a.kind === 'task');
        if (!existingTask && idx < 0) return {};

        const desc = existingTask?.description
          || (idx >= 0 ? (agents[idx].prompt || agents[idx].name) : defaultTaskLabel);
        const nextAgents = idx >= 0
          ? agents.map((a, i) => (
            i === idx
              ? {
                  ...a,
                  status,
                  completed_at: new Date().toISOString(),
                  ...(summary ? { result_summary: summary } : {}),
                }
              : a
          ))
          : [
              ...agents,
              {
                id: taskId,
                name: desc.slice(0, 40),
                prompt: desc,
                status,
                kind: 'task' as const,
                created_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                ...(summary ? { result_summary: summary } : {}),
              },
            ];
        targetChatJid = taskChatJid;
        return {
          sdkTasks: {
            ...s.sdkTasks,
            [taskId]: {
              chatJid: taskChatJid,
              description: desc,
              status,
              summary: summary ?? existingTask?.summary,
            },
          },
          agents: { ...s.agents, [taskChatJid]: nextAgents },
        };
      });
      if (targetChatJid) {
        scheduleSdkTaskCleanup(set, taskId, targetChatJid, closeAfterMs);
      }
    };

    // ② task_start / Task tool start → 创建/更新虚拟 Agent（SDK Task）
    if (
      (event.eventType === 'task_start' && event.toolUseId)
      || (event.eventType === 'tool_use_start' && event.toolName === 'Task' && event.toolUseId)
    ) {
      ensureSdkTask(
        event.toolUseId!,
        event.taskDescription || event.toolInputSummary,
      );
      // 不 return — 让 task_start 同时落入主对话 streaming（显示 Task 工具卡片）
    }

    // ③ task_notification → 标记完成/失败并自动关闭标签页
    if (event.eventType === 'task_notification' && event.taskId) {
      const resolvedTaskId = resolveOrBindTaskId(event.taskId);
      finalizeSdkTask(
        resolvedTaskId,
        event.taskStatus === 'completed' ? 'completed' : 'error',
        event.taskSummary,
      );
      // 不落入主对话 streaming
      return;
    }

    // ④ parentToolUseId 匹配虚拟 Agent → 路由到 subagent streaming
    if (event.parentToolUseId) {
      const tid = resolveOrBindTaskId(event.parentToolUseId);
      const state = get();
      const taskFromDb = (state.agents[chatJid] || []).find(a => a.id === tid && a.kind === 'task');
      const knownTask = !!state.sdkTasks[tid] || !!taskFromDb;
      if (knownTask) {
        if (!state.sdkTasks[tid]) {
          ensureSdkTask(tid, taskFromDb?.prompt || taskFromDb?.name);
        }
        set((s) => {
          const prev = s.agentStreaming[tid] || { ...DEFAULT_STREAMING_STATE };
          const next = { ...prev };
          applyStreamEvent(event, prev, next, 8000);
          return { agentStreaming: { ...s.agentStreaming, [tid]: next } };
        });
        return;
      }
    }

    // ⑤ task tool_use_end 兜底：若 task_notification 缺失，仍然收敛状态并自动关闭
    if (event.eventType === 'tool_use_end' && event.toolUseId) {
      const resolvedToolUseId = resolveOrBindTaskId(event.toolUseId);
      const task = get().sdkTasks[resolvedToolUseId];
      if (task && task.status === 'running') {
        finalizeSdkTask(resolvedToolUseId, 'completed', task.summary, SDK_TASK_TOOL_END_FALLBACK_CLOSE_MS);
      }
      // fall-through 到主对话处理，移除 activeTools 中的 Task 条目
    }

    // 中断事件需要在所有客户端显式收尾，避免 waiting 残留。
    if (event.eventType === 'status' && isStreamTerminalStatus(event.statusText)) {
      set((s) => {
        const nextStreaming = { ...s.streaming };
        delete nextStreaming[chatJid];
        const nextPendingThinking = { ...s.pendingThinking };
        delete nextPendingThinking[chatJid];
        const nextWaiting = { ...s.waiting };
        delete nextWaiting[chatJid];
        return {
          waiting: nextWaiting,
          streaming: nextStreaming,
          pendingThinking: nextPendingThinking,
        };
      });
      return;
    }

    // ⑥ 主对话 streaming — 使用 applyStreamEvent 共享函数
    set((s) => {
      const MAX_STREAMING_TEXT = 8000;
      const prev = s.streaming[chatJid] || { ...DEFAULT_STREAMING_STATE };
      const next = { ...prev };
      applyStreamEvent(event, prev, next, MAX_STREAMING_TEXT);
      return {
        waiting: { ...s.waiting, [chatJid]: true },
        streaming: { ...s.streaming, [chatJid]: next },
      };
    });
  },

  // 通过 WebSocket new_message 事件立即添加消息（避免轮询延迟导致消息"丢失"）
  handleWsNewMessage: (chatJid, wsMsg, agentId?) => {
    if (!wsMsg || !wsMsg.id) return;
    // Skip while clearHistory is in-flight to prevent race re-injection
    if (get().clearing[chatJid]) return;

    const msg: Message = {
      id: wsMsg.id,
      chat_jid: wsMsg.chat_jid || chatJid,
      sender: wsMsg.sender || '',
      sender_name: wsMsg.sender_name || '',
      content: wsMsg.content || '',
      timestamp: wsMsg.timestamp || new Date().toISOString(),
      is_from_me: wsMsg.is_from_me ?? false,
      attachments: wsMsg.attachments,
      provider: wsMsg.provider ?? null,
    };
    const shouldRefreshWorkflowState =
      msg.sender === '__system__'
      && (
        msg.content.startsWith('workflow:')
        || msg.content.startsWith('workflow_recommend:')
      );

    // Route to agentMessages if this is a conversation agent message
    if (agentId) {
      set((s) => {
        const existing = s.agentMessages[agentId] || [];
        const alreadyExists = existing.some((m) => m.id === wsMsg.id);
        const updated = alreadyExists ? existing : [...existing, msg];
        const isAgentReply = msg.is_from_me && msg.sender !== '__system__';
        const directiveProvider =
          !msg.is_from_me && msg.sender !== '__system__'
            ? getDirectiveProvider(msg.content)
            : null;

        const nextAgentStreaming = isAgentReply
          ? (() => { const n = { ...s.agentStreaming }; delete n[agentId]; return n; })()
          : s.agentStreaming;

        return {
          agentMessages: { ...s.agentMessages, [agentId]: updated },
          agentWaiting: isAgentReply
            ? { ...s.agentWaiting, [agentId]: false }
            : s.agentWaiting,
          agentStreaming: nextAgentStreaming,
          agentCurrentProvider:
            directiveProvider
              ? { ...s.agentCurrentProvider, [agentId]: directiveProvider }
              : s.agentCurrentProvider,
        };
      });
      return;
    }

    set((s) => {
      const existing = s.messages[chatJid] || [];

      // 消息已存在时保留原顺序，仅执行状态收尾（清 waiting/streaming）
      const alreadyExists = existing.some((m) => m.id === wsMsg.id);
      const updated = alreadyExists ? existing : [...existing, msg];

      const isAgentReply = msg.is_from_me && msg.sender !== '__system__';
      const isSystemError =
        msg.sender === '__system__' &&
        isTerminalSystemMessage(msg.content);
      const directiveProvider =
        !msg.is_from_me && msg.sender !== '__system__'
          ? getDirectiveProvider(msg.content)
          : null;
      const nextGroups =
        directiveProvider && s.groups[chatJid]
          ? {
              ...s.groups,
              [chatJid]: {
                ...s.groups[chatJid],
                effective_provider: directiveProvider,
              },
            }
          : s.groups;

      if (isAgentReply || isSystemError) {
        // Agent 回复或系统错误：立即清除流式状态和等待标志，转移 thinking 缓存
        const streamState = s.streaming[chatJid];
        const thinkingText = isAgentReply
          ? (streamState?.thinkingText || s.pendingThinking[chatJid])
          : undefined;
        const nextStreaming = { ...s.streaming };
        delete nextStreaming[chatJid];
        const nextPending = { ...s.pendingThinking };
        delete nextPending[chatJid];

        return {
          groups: nextGroups,
          messages: { ...s.messages, [chatJid]: updated },
          waiting: { ...s.waiting, [chatJid]: false },
          streaming: nextStreaming,
          pendingThinking: nextPending,
          ...(thinkingText ? { thinkingCache: capThinkingCache({ ...s.thinkingCache, [msg.id]: thinkingText }) } : {}),
        };
      }

      // 普通消息（如其他用户发送的消息）：只添加到列表
      return {
        groups: nextGroups,
        messages: { ...s.messages, [chatJid]: updated },
      };
    });

    if (shouldRefreshWorkflowState) {
      void get().loadGroups();
    }
  },

  // 处理子 Agent 状态变更事件
  handleAgentStatus: (chatJid, agentId, status, name, prompt, resultSummary?, kind?) => {
    set((s) => {
      const existing = s.agents[chatJid] || [];

      // '__removed__' signal: agent has been cleaned up, remove from list
      if (resultSummary === '__removed__') {
        clearSdkTaskCleanupTimer(agentId);
        const filtered = existing.filter((a) => a.id !== agentId);
        const nextAgentStreaming = { ...s.agentStreaming };
        delete nextAgentStreaming[agentId];
        const nextActiveTab = { ...s.activeAgentTab };
        if (nextActiveTab[chatJid] === agentId) nextActiveTab[chatJid] = null;
        const nextSdkTasks = { ...s.sdkTasks };
        delete nextSdkTasks[agentId];
        const nextSdkTaskAliases = removeSdkTaskAliases(s.sdkTaskAliases, agentId);
        // Clean up conversation agent state
        const nextAgentMessages = { ...s.agentMessages };
        delete nextAgentMessages[agentId];
        const nextAgentWaiting = { ...s.agentWaiting };
        delete nextAgentWaiting[agentId];
        const nextAgentHasMore = { ...s.agentHasMore };
        delete nextAgentHasMore[agentId];
        const nextAgentCurrentProvider = { ...s.agentCurrentProvider };
        delete nextAgentCurrentProvider[agentId];
        return {
          agents: { ...s.agents, [chatJid]: filtered },
          agentStreaming: nextAgentStreaming,
          activeAgentTab: nextActiveTab,
          sdkTasks: nextSdkTasks,
          sdkTaskAliases: nextSdkTaskAliases,
          agentMessages: nextAgentMessages,
          agentWaiting: nextAgentWaiting,
          agentHasMore: nextAgentHasMore,
          agentCurrentProvider: nextAgentCurrentProvider,
        };
      }

      const idx = existing.findIndex((a) => a.id === agentId);
      const resolvedKind = kind || (idx >= 0 ? existing[idx].kind : 'task');
      const agentInfo: AgentInfo = {
        id: agentId,
        name,
        prompt,
        status,
        kind: resolvedKind,
        created_at: idx >= 0 ? existing[idx].created_at : new Date().toISOString(),
        completed_at: (status === 'completed' || status === 'error') ? new Date().toISOString() : undefined,
        result_summary: resultSummary,
      };
      const updated = idx >= 0
        ? existing.map((a, i) => (i === idx ? agentInfo : a))
        : [...existing, agentInfo];

      // Clean up agent streaming if not actively running
      const nextAgentStreaming = { ...s.agentStreaming };
      if (status !== 'running') {
        delete nextAgentStreaming[agentId];
      }
      const nextSdkTasks = { ...s.sdkTasks };
      let nextSdkTaskAliases = { ...s.sdkTaskAliases };
      if (resolvedKind === 'task') {
        if (status !== 'running') {
          clearSdkTaskCleanupTimer(agentId);
          delete nextSdkTasks[agentId];
          nextSdkTaskAliases = removeSdkTaskAliases(nextSdkTaskAliases, agentId);
        } else if (nextSdkTasks[agentId]) {
          nextSdkTasks[agentId] = {
            ...nextSdkTasks[agentId],
            chatJid,
            description: prompt,
            status: 'running',
          };
        }
      }

      return {
        agents: { ...s.agents, [chatJid]: updated },
        agentStreaming: nextAgentStreaming,
        sdkTasks: nextSdkTasks,
        sdkTaskAliases: nextSdkTaskAliases,
      };
    });
  },

  // 加载子 Agent 列表
  loadAgents: async (jid) => {
    try {
      const data = await api.get<{ agents: AgentInfo[] }>(
        `/api/groups/${encodeURIComponent(jid)}/agents`,
      );
      set((s) => {
        const visibleAgents = data.agents.filter((a) => a.kind === 'conversation' || a.status === 'running');
        const runningTasks = data.agents.filter((a) => a.kind === 'task' && a.status === 'running');
        const runningTaskIds = new Set(runningTasks.map((a) => a.id));
        const runningTaskMap = new Map(runningTasks.map((a) => [a.id, a]));

        const nextSdkTasks: ChatState['sdkTasks'] = {};
        for (const [id, task] of Object.entries(s.sdkTasks)) {
          if (task.chatJid !== jid) {
            nextSdkTasks[id] = task;
            continue;
          }
          if (runningTaskIds.has(id)) {
            const agent = runningTaskMap.get(id)!;
            nextSdkTasks[id] = {
              ...task,
              chatJid: jid,
              description: agent.prompt || agent.name,
              status: 'running',
            };
          } else {
            clearSdkTaskCleanupTimer(id);
          }
        }

        for (const agent of runningTasks) {
          if (!nextSdkTasks[agent.id]) {
            nextSdkTasks[agent.id] = {
              chatJid: jid,
              description: agent.prompt || agent.name,
              status: 'running',
            };
          }
        }

        const nextAgentStreaming = { ...s.agentStreaming };
        for (const [id, task] of Object.entries(s.sdkTasks)) {
          if (task.chatJid === jid && !runningTaskIds.has(id)) {
            delete nextAgentStreaming[id];
          }
        }

        const nextActiveTab = { ...s.activeAgentTab };
        if (nextActiveTab[jid] && !runningTaskIds.has(nextActiveTab[jid]!)) {
          const stillExists = visibleAgents.some((a) => a.id === nextActiveTab[jid]);
          if (!stillExists) nextActiveTab[jid] = null;
        }

        const nextSdkTaskAliases: Record<string, string> = {};
        for (const [alias, target] of Object.entries(s.sdkTaskAliases)) {
          const task = nextSdkTasks[target];
          if (!task) continue;
          if (task.chatJid === jid && task.status !== 'running') continue;
          if (alias === target && task.status !== 'running') continue;
          nextSdkTaskAliases[alias] = target;
        }

        return {
          agents: { ...s.agents, [jid]: visibleAgents },
          sdkTasks: nextSdkTasks,
          sdkTaskAliases: nextSdkTaskAliases,
          agentStreaming: nextAgentStreaming,
          activeAgentTab: nextActiveTab,
        };
      });
    } catch {
      // Silent fail
    }
  },

  // 删除子 Agent
  deleteAgentAction: async (jid, agentId) => {
    try {
      await api.delete(`/api/groups/${encodeURIComponent(jid)}/agents/${agentId}`);
      clearSdkTaskCleanupTimer(agentId);
      set((s) => {
        const updated = (s.agents[jid] || []).filter((a) => a.id !== agentId);
        const nextAgentStreaming = { ...s.agentStreaming };
        delete nextAgentStreaming[agentId];
        const nextActiveTab = { ...s.activeAgentTab };
        if (nextActiveTab[jid] === agentId) nextActiveTab[jid] = null;
        const nextSdkTasks = { ...s.sdkTasks };
        delete nextSdkTasks[agentId];
        const nextSdkTaskAliases = removeSdkTaskAliases(s.sdkTaskAliases, agentId);
        const nextQueuedAgentMessages = { ...s.queuedAgentMessages };
        delete nextQueuedAgentMessages[agentId];
        const nextSendingQueuedAgent = { ...s.sendingQueuedAgent };
        delete nextSendingQueuedAgent[agentId];
        return {
          agents: { ...s.agents, [jid]: updated },
          agentStreaming: nextAgentStreaming,
          activeAgentTab: nextActiveTab,
          sdkTasks: nextSdkTasks,
          sdkTaskAliases: nextSdkTaskAliases,
          queuedAgentMessages: nextQueuedAgentMessages,
          sendingQueuedAgent: nextSendingQueuedAgent,
        };
      });
      return true;
    } catch {
      return false;
    }
  },

  // 切换子 Agent 标签页
  setActiveAgentTab: (jid, agentId) => {
    set((s) => ({
      activeAgentTab: { ...s.activeAgentTab, [jid]: agentId },
    }));
  },

  // -- Conversation agent actions --

  createConversation: async (jid, name, description?) => {
    try {
      const data = await api.post<{ agent: AgentInfo }>(
        `/api/groups/${encodeURIComponent(jid)}/agents`,
        { name, description },
      );
      set((s) => {
        const existing = s.agents[jid] || [];
        // WS agent_status broadcast may have already added it
        if (existing.some((a) => a.id === data.agent.id)) return s;
        return { agents: { ...s.agents, [jid]: [...existing, data.agent] } };
      });
      return data.agent;
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.createConversationFailed') });
      return null;
    }
  },

  loadAgentMessages: async (jid, agentId, loadMore = false) => {
    const existing = get().agentMessages[agentId] || [];
    const before = loadMore && existing.length > 0 ? existing[0].timestamp : undefined;

    try {
      const params = new URLSearchParams(
        before
          ? { before: String(before), limit: '50', agentId }
          : { limit: '50', agentId },
      );
      const data = await api.get<{ messages: Message[]; hasMore: boolean }>(
        `/api/groups/${encodeURIComponent(jid)}/messages?${params}`,
      );
      const sorted = [...data.messages].reverse();
      set((s) => {
        const merged = mergeMessagesChronologically(
          s.agentMessages[agentId] || [],
          sorted,
        );
        return {
          agentMessages: { ...s.agentMessages, [agentId]: merged },
          agentHasMore: { ...s.agentHasMore, [agentId]: data.hasMore },
        };
      });
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.loadAgentMessagesFailed') });
    }
  },

  sendAgentMessageNow: (
    jid,
    agentId,
    content,
    operationPermissionMode,
  ) => {
    // Clear agent streaming state before sending
    set((s) => {
      const next = { ...s.agentStreaming };
      delete next[agentId];
      return { agentStreaming: next };
    });
    // Send via WebSocket with agentId
    wsManager.send({
      type: 'send_message',
      chatJid: jid,
      content,
      agentId,
      operationPermissionMode,
    });
    const directiveProvider = getDirectiveProvider(content);
    const workflowDirective = parseWorkflowDirectiveInput(content);
    set((s) => ({
      agentWaiting: (() => {
        const nextWaiting = { ...s.agentWaiting };
        if (isProviderDirectiveOnly(content) || workflowDirective.isCommandOnly) {
          delete nextWaiting[agentId];
        } else {
          nextWaiting[agentId] = true;
        }
        return nextWaiting;
      })(),
      agentCurrentProvider:
        directiveProvider
          ? { ...s.agentCurrentProvider, [agentId]: directiveProvider }
          : s.agentCurrentProvider,
    }));
  },

  sendAgentMessage: (jid, agentId, content, operationPermissionMode) => {
    const state = get();
    const queued = state.queuedAgentMessages[agentId] || [];
    if (
      isAgentConversationBusy(state, agentId) ||
      queued.length > 0 ||
      !!state.sendingQueuedAgent[agentId]
    ) {
      const queuedMessage = createQueuedMessage(
        content,
        undefined,
        operationPermissionMode,
      );
      set((s) => ({
        queuedAgentMessages: {
          ...s.queuedAgentMessages,
          [agentId]: [...(s.queuedAgentMessages[agentId] || []), queuedMessage],
        },
      }));
      return;
    }
    get().sendAgentMessageNow(jid, agentId, content, operationPermissionMode);
  },

  flushQueuedAgentMessages: async (jid, agentId) => {
    const state = get();
    if (state.sendingQueuedAgent[agentId] || isAgentConversationBusy(state, agentId)) return;
    const queue = state.queuedAgentMessages[agentId] || [];
    if (queue.length === 0) return;

    const [next, ...rest] = queue;
    set((s) => ({
      queuedAgentMessages: {
        ...s.queuedAgentMessages,
        [agentId]: rest,
      },
      sendingQueuedAgent: {
        ...s.sendingQueuedAgent,
        [agentId]: true,
      },
    }));

    try {
      get().sendAgentMessageNow(
        jid,
        agentId,
        next.content,
        next.operationPermissionMode,
      );
    } finally {
      set((s) => ({
        sendingQueuedAgent: {
          ...s.sendingQueuedAgent,
          [agentId]: false,
        },
      }));
    }
  },

  removeQueuedAgentMessage: (agentId, queuedMessageId) => {
    set((s) => ({
      queuedAgentMessages: {
        ...s.queuedAgentMessages,
        [agentId]: (s.queuedAgentMessages[agentId] || []).filter((m) => m.id !== queuedMessageId),
      },
    }));
  },

  clearQueuedAgentMessages: (agentId) => {
    set((s) => ({
      queuedAgentMessages: {
        ...s.queuedAgentMessages,
        [agentId]: [],
      },
    }));
  },

  refreshAgentMessages: async (jid, agentId) => {
    const existing = get().agentMessages[agentId] || [];
    const lastTs = existing.length > 0 ? existing[existing.length - 1].timestamp : undefined;

    try {
      const params = new URLSearchParams({ limit: '50', agentId });
      if (lastTs) params.set('after', lastTs);

      const data = await api.get<{ messages: Message[] }>(
        `/api/groups/${encodeURIComponent(jid)}/messages?${params}`,
      );

      if (data.messages.length > 0) {
        set((s) => {
          const merged = mergeMessagesChronologically(
            s.agentMessages[agentId] || [],
            data.messages,
          );
          const agentReplied = data.messages.some(
            (m) => m.is_from_me && m.sender !== '__system__',
          );
          const nextAgentStreaming = agentReplied
            ? (() => { const n = { ...s.agentStreaming }; delete n[agentId]; return n; })()
            : s.agentStreaming;

          return {
            agentMessages: { ...s.agentMessages, [agentId]: merged },
            agentWaiting: agentReplied
              ? { ...s.agentWaiting, [agentId]: false }
              : s.agentWaiting,
            agentStreaming: nextAgentStreaming,
          };
        });
      }
    } catch (err) {
      set({ error: chatStoreError(err, 'chat.store.errors.refreshAgentMessagesFailed') });
    }
  },

  // 刷新/重连时恢复正在运行的 agent 状态
  restoreActiveState: async () => {
    try {
      const data = await api.get<{ groups: Array<{ jid: string; active: boolean; pendingMessages?: boolean }> }>('/api/status');
      set((s) => {
        const nextWaiting = { ...s.waiting };
        for (const g of data.groups) {
          if (g.pendingMessages) {
            nextWaiting[g.jid] = true;
            continue;
          }
          // active 可能仅表示 runner 空闲存活，这里回退到消息语义推断。
          const msgs = s.messages[g.jid] || [];
          const latest = msgs.length > 0 ? msgs[msgs.length - 1] : null;
          const inferredWaiting = shouldWaitForReplyFromLatestMessage(latest);
          if (inferredWaiting) {
            nextWaiting[g.jid] = true;
          } else {
            delete nextWaiting[g.jid];
          }
        }
        return { waiting: nextWaiting };
      });
    } catch {
      // 静默失败
    }
  },

  // 清除流式状态
  clearStreaming: (chatJid, options) => {
    set((s) => {
      const next = { ...s.streaming };
      const thinkingText = next[chatJid]?.thinkingText;
      const preserveThinking = options?.preserveThinking !== false;
      const nextPendingThinking = { ...s.pendingThinking };
      delete next[chatJid];
      if (preserveThinking && thinkingText) {
        nextPendingThinking[chatJid] = thinkingText;
      } else {
        delete nextPendingThinking[chatJid];
      }
      return {
        waiting: { ...s.waiting, [chatJid]: false },
        streaming: next,
        pendingThinking: nextPendingThinking,
      };
    });
  },
}));
