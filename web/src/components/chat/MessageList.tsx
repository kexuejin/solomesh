import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate } from 'react-router-dom';
import { Message, useChatStore } from '../../stores/chat';
import type { AgentInfo } from '../../types';
import { MessageBubble } from './MessageBubble';
import { StreamingDisplay } from './StreamingDisplay';
import { AgentStatusCard } from './AgentStatusCard';
import { api } from '../../api/client';
import {
  parseSystemChatMessage,
  type WorkflowDependencyBlockedSystemPayload,
  type WorkflowTemplateEditSystemPayload,
} from '../../lib/system-message';
import { Loader2, ChevronUp, ChevronDown, AlertTriangle, Square, Workflow, Rocket } from 'lucide-react';

interface MessageListProps {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Increment to force scroll to bottom (e.g. after sending a message) */
  scrollTrigger?: number;
  /** Current group JID — used to save/restore scroll position across group switches */
  groupJid?: string;
  /** Whether the agent is currently processing */
  isWaiting?: boolean;
  /** Callback to interrupt the current agent query */
  onInterrupt?: () => void;
  /** Sub-agents to display as status cards in the main conversation */
  agents?: AgentInfo[];
  /** Callback when a sub-agent status card is clicked */
  onAgentClick?: (agentId: string) => void;
  /** If set, this MessageList is showing a sub-agent's messages */
  agentId?: string;
  /** Optional send callback used by embedded task cards */
  onSend?: (content: string) => Promise<void>;
}

type FlatItem =
  | { type: 'date'; content: string }
  | { type: 'divider'; id: string; content: string }
  | { type: 'error'; id: string; content: string }
  | { type: 'workflow_dependency_blocked'; id: string; payload: WorkflowDependencyBlockedSystemPayload }
  | { type: 'workflow_template_edit'; id: string; payload: WorkflowTemplateEditSystemPayload }
  | { type: 'message'; content: Message };

type WorkflowSettingsTab = WorkflowDependencyBlockedSystemPayload['suggestedTabs'][number];

function getWorkflowSettingsTabLabel(tab: WorkflowSettingsTab): string {
  if (tab === 'runtime') return 'Agent 运行时';
  if (tab === 'my-channels') return '消息通道';
  if (tab === 'skills') return '技能管理';
  return 'Workflow 模板';
}

function parseSystemMessage(message: Message): FlatItem {
  const parsed = parseSystemChatMessage(message.content);
  if (parsed.type === 'workflow_dependency_blocked') {
    return {
      type: 'workflow_dependency_blocked',
      id: message.id,
      payload: parsed.payload,
    };
  }
  if (parsed.type === 'workflow_template_edit') {
    return {
      type: 'workflow_template_edit',
      id: message.id,
      payload: parsed.payload,
    };
  }
  if (parsed.type === 'error') {
    return {
      type: 'error',
      id: message.id,
      content: parsed.content,
    };
  }
  return {
    type: 'divider',
    id: message.id,
    content: parsed.content,
  };
}

export function MessageList({ messages, loading, hasMore, onLoadMore, scrollTrigger, groupJid, isWaiting, onInterrupt, agents, onAgentClick, agentId }: MessageListProps) {
  const thinkingCache = useChatStore(s => s.thinkingCache ?? {});
  const isShared = useChatStore(s => !!s.groups[groupJid ?? '']?.is_shared);
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [atTop, setAtTop] = useState(false);
  const [publishingTemplateMessageId, setPublishingTemplateMessageId] = useState<string | null>(null);
  const [retryingDependencyMessageId, setRetryingDependencyMessageId] = useState<string | null>(null);
  const [templateActionResult, setTemplateActionResult] = useState<Record<string, string>>({});
  const prevMessageCount = useRef(messages.length);

  const publishTemplateDraft = useCallback(async (messageId: string, payload: WorkflowTemplateEditSystemPayload) => {
    setTemplateActionResult((prev) => ({ ...prev, [messageId]: '' }));
    setPublishingTemplateMessageId(messageId);
    try {
      await api.post<{ template: unknown }>(
        `/api/workflows/templates/${payload.scope}/${encodeURIComponent(payload.templateId)}/publish`,
        groupJid ? { chatJid: groupJid } : undefined,
      );
      if (!groupJid) {
        setTemplateActionResult((prev) => ({
          ...prev,
          [messageId]: `模板 ${payload.templateId} 已发布`,
        }));
      }
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message || '发布失败')
          : '发布失败';
      setTemplateActionResult((prev) => ({
        ...prev,
        [messageId]: `发布失败：${message}`,
      }));
    } finally {
      setPublishingTemplateMessageId((current) => (current === messageId ? null : current));
    }
  }, [groupJid]);

  const retryDependencyCheck = useCallback(async (messageId: string) => {
    if (!groupJid) return;
    setTemplateActionResult((prev) => ({ ...prev, [messageId]: '' }));
    setRetryingDependencyMessageId(messageId);
    try {
      await api.post('/api/messages', {
        chatJid: groupJid,
        content: '/wf-status',
      });
      setTemplateActionResult((prev) => ({
        ...prev,
        [messageId]: '已触发依赖重试检查，请查看后续 workflow 系统消息。',
      }));
    } catch (err) {
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message || '重试失败')
          : '重试失败';
      setTemplateActionResult((prev) => ({
        ...prev,
        [messageId]: `重试失败：${message}`,
      }));
    } finally {
      setRetryingDependencyMessageId((current) => (current === messageId ? null : current));
    }
  }, [groupJid]);

  // Compute flatMessages (with date headers) before virtualizer
  const flatMessages = useMemo<FlatItem[]>(() => {
    const grouped = messages.reduce((acc, msg) => {
      const date = new Date(msg.timestamp).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      if (!acc[date]) acc[date] = [];
      acc[date].push(msg);
      return acc;
    }, {} as Record<string, Message[]>);

    const items: FlatItem[] = [];
    Object.entries(grouped).forEach(([date, msgs]) => {
      items.push({ type: 'date', content: date });
      msgs.forEach((msg) => {
        if (msg.sender === '__system__') {
          items.push(parseSystemMessage(msg));
        } else {
          items.push({ type: 'message', content: msg });
        }
      });
    });
    return items;
  }, [messages]);

  // Chat always starts at bottom — no scroll position restoration.
  // key={...} on <MessageList> guarantees a fresh mount on group/tab switch.
  const virtualizer = useVirtualizer({
    count: flatMessages.length,
    getScrollElement: () => parentRef.current,
    initialOffset: flatMessages.length > 0 ? 99999999 : 0,
    getItemKey: (index) => {
      const item = flatMessages[index];
      if (!item) return index;
      switch (item.type) {
        case 'date': return `date-${item.content}`;
        case 'divider': return `div-${item.id}`;
        case 'error': return `err-${item.id}`;
        case 'workflow_dependency_blocked': return `workflow-dependency-blocked-${item.id}`;
        case 'workflow_template_edit': return `workflow-template-edit-${item.id}`;
        case 'message': return item.content.id;
      }
    },
    estimateSize: (index) => {
      const item = flatMessages[index];
      if (!item) return 100;
      switch (item.type) {
        case 'date': return 48;
        case 'divider':
        case 'error': return 56;
        case 'workflow_dependency_blocked': return 220;
        case 'workflow_template_edit': return 150;
        case 'message': {
          const len = item.content.content.length;
          if (item.content.is_from_me) {
            return Math.max(80, Math.min(400, Math.ceil(len / 50) * 24 + 60));
          }
          return Math.max(48, Math.min(200, Math.ceil(len / 80) * 24 + 40));
        }
        default: return 100;
      }
    },
    overscan: 8,
  });

  // 检测向上滚动触发 loadMore + 保存滚动位置
  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = parent;
      const atBottom = scrollHeight - scrollTop - clientHeight < 100;
      setAutoScroll(atBottom);
      setAtTop(scrollTop < 50);

      if (scrollTop < 100 && hasMore && !loading) {
        onLoadMore();
      }
    };

    parent.addEventListener('scroll', handleScroll);
    return () => parent.removeEventListener('scroll', handleScroll);
  }, [hasMore, loading, onLoadMore, groupJid]);

  // 新消息自动滚到底部
  useEffect(() => {
    if (autoScroll && messages.length > prevMessageCount.current) {
      requestAnimationFrame(() => {
        parentRef.current?.scrollTo({ top: parentRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, autoScroll]);

  // 外部触发滚到底部（发送消息后）
  useEffect(() => {
    if (scrollTrigger && scrollTrigger > 0) {
      setAutoScroll(true);
      requestAnimationFrame(() => {
        parentRef.current?.scrollTo({ top: parentRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [scrollTrigger]);

  // Fallback: 消息在挂载后加载（首次页面加载时 store 为空）
  // initialOffset 只在挂载时生效，消息后加载需要手动定位
  const initialScrollDone = useRef(flatMessages.length > 0);
  useLayoutEffect(() => {
    if (!initialScrollDone.current && flatMessages.length > 0) {
      initialScrollDone.current = true;
      prevMessageCount.current = messages.length;
      virtualizer.scrollToIndex(flatMessages.length - 1, { align: 'end' });
      if (parentRef.current) {
        parentRef.current.scrollTop = parentRef.current.scrollHeight;
      }
      setAutoScroll(true);
    }
  }, [flatMessages.length, virtualizer, messages.length]);

  // Safety net: initialOffset relies on estimated sizes which may be inaccurate.
  // After mount, verify we're actually at the bottom and correct if not.
  useEffect(() => {
    if (flatMessages.length === 0) return;
    const raf1 = requestAnimationFrame(() => {
      const el = parentRef.current;
      if (!el) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap > 100) {
        el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf1);
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll when streaming content updates
  const streaming = useChatStore(s => agentId ? s.agentStreaming[agentId] : s.streaming[groupJid ?? '']);
  useEffect(() => {
    if (autoScroll && streaming) {
      parentRef.current?.scrollTo({ top: parentRef.current.scrollHeight });
    }
  }, [streaming, autoScroll]);

  const scrollToTop = useCallback(() => {
    parentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const scrollToBottom = useCallback(() => {
    const parent = parentRef.current;
    if (!parent) return;
    parent.scrollTo({ top: parent.scrollHeight, behavior: 'smooth' });
  }, []);

  const showScrollButtons = messages.length > 0;

  return (
    <div className="relative flex-1 overflow-hidden overflow-x-hidden">
      <div
        ref={parentRef}
        className="h-full overflow-y-auto overflow-x-hidden bg-background py-8"
      >
        <div className="mx-auto min-w-0 max-w-4xl px-6">
        {loading && hasMore && (
          <div className="flex justify-center py-4">
            <Loader2 className="animate-spin text-primary" size={24} />
          </div>
        )}

        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = flatMessages[virtualItem.index];
            if (!item) return null;

            if (item.type === 'date') {
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="my-6 flex justify-center">
                    <span className="rounded-full border border-sidebar-border bg-card px-4 py-1 text-xs text-muted-foreground">
                      {item.content}
                    </span>
                  </div>
                </div>
              );
            }

            if (item.type === 'divider') {
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="flex items-center gap-3 my-6 px-4">
                    <div className="flex-1 border-t border-amber-300" />
                    <span className="text-xs text-amber-600 whitespace-pre-wrap">
                      {item.content}
                    </span>
                    <div className="flex-1 border-t border-amber-300" />
                  </div>
                </div>
              );
            }

            if (item.type === 'error') {
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="flex items-center gap-3 my-6 px-4">
                    <div className="flex-1 border-t border-red-300" />
                    <span className="text-xs text-red-600 whitespace-pre-wrap flex items-center gap-1">
                      <AlertTriangle size={14} />
                      {item.content}
                    </span>
                    <div className="flex-1 border-t border-red-300" />
                  </div>
                </div>
              );
            }

            if (item.type === 'workflow_template_edit') {
              const payload = item.payload;
              const actionResult = templateActionResult[item.id];
              const publishing = publishingTemplateMessageId === item.id;
              const statusLabel =
                payload.status === 'published'
                  ? '已发布'
                  : payload.status === 'publish_failed'
                    ? '发布失败'
                    : '草稿已更新';
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="my-4 px-4">
                    <div className="rounded-xl border border-border/70 bg-muted/10 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Workflow className="w-4 h-4 text-sky-600" />
                        模板更新：{payload.templateId}
                        {typeof payload.version === 'number' && (
                          <span className="text-xs font-normal text-muted-foreground">
                            v{payload.version}
                          </span>
                        )}
                        <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${
                          payload.status === 'published'
                            ? 'bg-emerald-100 text-emerald-700'
                            : payload.status === 'publish_failed'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}>
                          {statusLabel}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">
                        {payload.summary}
                      </div>
                      {payload.reason && (
                        <div className="mt-1 text-xs text-rose-600 whitespace-pre-wrap">
                          {payload.reason}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {payload.publishable && (
                          <button
                            type="button"
                            onClick={() => void publishTemplateDraft(item.id, payload)}
                            disabled={publishing}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                          >
                            {publishing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
                            发布草稿
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => navigate('/settings?tab=workflows')}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/70 bg-muted/60 px-2 py-1 text-xs text-foreground hover:bg-muted"
                        >
                          打开模板设置
                        </button>
                      </div>
                      {actionResult && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {actionResult}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            if (item.type === 'workflow_dependency_blocked') {
              const payload = item.payload;
              const actionResult = templateActionResult[item.id];
              const retrying = retryingDependencyMessageId === item.id;
              const quickTabs = payload.suggestedTabs;
              return (
                <div
                  key={virtualItem.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualItem.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="my-4 px-4">
                    <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-rose-700">
                        <AlertTriangle className="w-4 h-4" />
                        阶段依赖阻塞：{payload.stageName}
                      </div>
                      <div className="mt-2 text-xs text-rose-700 whitespace-pre-wrap">
                        {payload.blockedReason}
                      </div>
                      {payload.dependencies.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {payload.dependencies.map((dependency, index) => (
                            <div
                              key={`${dependency.type}:${dependency.ref}:${index}`}
                              className="flex items-start justify-between gap-2 rounded-md bg-rose-50/30 px-2 py-1.5"
                            >
                              <div className="min-w-0 text-xs text-foreground whitespace-pre-wrap">
                                [{dependency.type}] {dependency.ref} · {dependency.reason}
                                {dependency.hint ? `（${dependency.hint}）` : ''}
                              </div>
                              {dependency.suggestedTab && (
                                <button
                                  type="button"
                                  onClick={() => navigate(`/settings?tab=${dependency.suggestedTab}`)}
                                  className="shrink-0 cursor-pointer rounded-md border border-border/70 bg-card px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                                >
                                  去{getWorkflowSettingsTabLabel(dependency.suggestedTab)}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {quickTabs.map((tab) => (
                          <button
                            type="button"
                            key={tab}
                            onClick={() => navigate(`/settings?tab=${tab}`)}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border/70 bg-card px-2 py-1 text-xs text-foreground hover:bg-muted"
                          >
                            打开{getWorkflowSettingsTabLabel(tab)}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => void retryDependencyCheck(item.id)}
                          disabled={!groupJid || retrying}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-100 px-2 py-1 text-xs text-rose-700 hover:bg-rose-200 disabled:opacity-60 cursor-pointer"
                        >
                          {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                          重试检查
                        </button>
                      </div>
                      {actionResult && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {actionResult}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            const message = item.content;
            const showTime = true;

            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
              >
                <MessageBubble message={message} showTime={showTime} thinkingContent={thinkingCache[message.id]} isShared={isShared} />
              </div>
            );
          })}
        </div>

        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-sm">暂无消息</p>
            <p className="text-xs mt-2">发送消息开始对话</p>
          </div>
        )}

        {groupJid && !agentId && (
          <StreamingDisplay groupJid={groupJid} isWaiting={!!isWaiting} />
        )}
        {groupJid && agentId && (
          <StreamingDisplay groupJid={groupJid} isWaiting={!!isWaiting} agentId={agentId} />
        )}

        {/* Agent status cards in main conversation (task agents only) */}
        {!agentId && agents && agents.filter(a => a.kind === 'task').length > 0 && (
          <div className="py-2">
            {agents.filter(a => a.kind === 'task').map((agent) => (
              <AgentStatusCard
                key={agent.id}
                agent={agent}
                onClick={() => onAgentClick?.(agent.id)}
              />
            ))}
          </div>
        )}

        {isWaiting && onInterrupt && (
          <div className="flex justify-center py-1">
            <button
              type="button"
              onClick={onInterrupt}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:text-red-600 bg-muted hover:bg-red-50 rounded-full transition-colors cursor-pointer"
            >
              <Square className="w-3 h-3" />
              中断
            </button>
          </div>
        )}
        </div>
      </div>

      {/* Floating scroll buttons */}
      {showScrollButtons && (
        <div className="absolute right-4 bottom-4 flex flex-col gap-1.5">
          {!atTop && (
            <button
              onClick={scrollToTop}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-card/95 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              title="回到顶部"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          )}
          {!autoScroll && (
            <button
              onClick={scrollToBottom}
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-card/95 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              title="回到底部"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
