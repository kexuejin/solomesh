import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { MessageList } from './MessageList';
import { MessageInput, type MessageInputSendOptions } from './MessageInput';
import { StreamingDisplay } from './StreamingDisplay';

import { FilePanel } from './FilePanel';
import { ContainerEnvPanel } from './ContainerEnvPanel';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ArrowLeft, FolderOpen, Link, Loader2, MoreHorizontal, PanelRightClose, PanelRightOpen, Sparkles, Terminal, Users, Wrench, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { wsManager } from '../../api/ws';
import { api } from '../../api/client';
import { TerminalPanel } from './TerminalPanel';
import { GroupSkillsPanel } from './GroupSkillsPanel';
import { GroupMembersPanel } from './GroupMembersPanel';
import { AgentTabBar } from './AgentTabBar';
import { useI18n } from '../../i18n';

/** Inline elapsed-time counter for running tasks */
function ElapsedTimer({ startTime }: { startTime: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.floor((Date.now() - startTime) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return <span>{mins > 0 ? `${mins}m ${secs}s` : `${secs}s`}</span>;
}

const POLL_INTERVAL_MS = 2000;
const TERMINAL_MIN_HEIGHT = 150;
const TERMINAL_DEFAULT_HEIGHT = 300;
const TERMINAL_MAX_RATIO = 0.7;

// Stable empty references to avoid infinite re-render loops in Zustand selectors
const EMPTY_AGENTS: import('../../types').AgentInfo[] = [];
const EMPTY_QUEUED_MESSAGES: import('../../stores/chat').QueuedOutgoingMessage[] = [];

type SidebarTab = 'files' | 'env' | 'skills' | 'members';
type MobilePanel = SidebarTab;

interface ChatViewProps {
  groupJid: string;
  onBack?: () => void;
}

interface ImChannelStatusItem {
  id: string;
  displayName: string;
  connected: boolean;
}

interface UserImSessionBinding {
  targetFolder: string;
  enabled: boolean;
  ownerUserId: string;
  updatedAt: string;
}

interface UserImSession {
  chatJid: string;
  channel: 'feishu' | 'telegram';
  name: string;
  lastActivity: string;
  mappedFolder: string | null;
  mappedWorkspaceName: string | null;
  binding: UserImSessionBinding | null;
}

interface UserImSessionsResponse {
  sessions: UserImSession[];
}

interface RemoteAccessLinkResponse {
  success: boolean;
  link: {
    url: string;
  };
}

export function ChatView({ groupJid, onBack }: ChatViewProps) {
  const { t } = useI18n();
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [bindingsOpen, setBindingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  // Desktop: visible controls panel height, mounted controls terminal lifecycle.
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(TERMINAL_DEFAULT_HEIGHT);
  const [mobileTerminal, setMobileTerminal] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingNotice, setBindingNotice] = useState<string | null>(null);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [workspaceSessions, setWorkspaceSessions] = useState<UserImSession[]>([]);
  const [sessionSavingByJid, setSessionSavingByJid] = useState<Record<string, boolean>>({});
  const [imStatus, setImStatus] = useState<ImChannelStatusItem[] | null>(null);
  const [creatingRemoteAccessLink, setCreatingRemoteAccessLink] = useState(false);
  const [imBannerDismissed, setImBannerDismissed] = useState(() =>
    localStorage.getItem('im-banner-dismissed') === '1',
  );
  const navigate = useNavigate();

  // Drag state refs (not reactive — only used in event handlers)
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  // Individual selectors: avoid re-renders from unrelated store changes (e.g. streaming)
  const group = useChatStore(s => s.groups[groupJid]);
  const groupMessages = useChatStore(s => s.messages[groupJid]);
  const isWaiting = useChatStore(s => !!s.waiting[groupJid]);
  const hasMoreMessages = useChatStore(s => !!s.hasMore[groupJid]);
  const loading = useChatStore(s => s.loading);
  const loadMessages = useChatStore(s => s.loadMessages);
  const loadGroups = useChatStore(s => s.loadGroups);
  const refreshMessages = useChatStore(s => s.refreshMessages);
  const sendMessage = useChatStore(s => s.sendMessage);
  const flushQueuedMainMessages = useChatStore(s => s.flushQueuedMainMessages);
  const removeQueuedMainMessage = useChatStore(s => s.removeQueuedMainMessage);
  const clearQueuedMainMessages = useChatStore(s => s.clearQueuedMainMessages);
  const interruptQuery = useChatStore(s => s.interruptQuery);
  const resetSession = useChatStore(s => s.resetSession);
  const handleStreamEvent = useChatStore(s => s.handleStreamEvent);
  const handleWsNewMessage = useChatStore(s => s.handleWsNewMessage);
  const handleAgentStatus = useChatStore(s => s.handleAgentStatus);
  const clearStreaming = useChatStore(s => s.clearStreaming);
  const agents = useChatStore(s => s.agents[groupJid] ?? EMPTY_AGENTS);
  const activeAgentTab = useChatStore(s => s.activeAgentTab[groupJid] ?? null);
  const setActiveAgentTab = useChatStore(s => s.setActiveAgentTab);
  const loadAgents = useChatStore(s => s.loadAgents);
  const deleteAgentAction = useChatStore(s => s.deleteAgentAction);
  const agentStreaming = useChatStore(s => s.agentStreaming);
  const sdkTasks = useChatStore(s => s.sdkTasks);
  const createConversation = useChatStore(s => s.createConversation);
  const loadAgentMessages = useChatStore(s => s.loadAgentMessages);
  const sendAgentMessage = useChatStore(s => s.sendAgentMessage);
  const flushQueuedAgentMessages = useChatStore(s => s.flushQueuedAgentMessages);
  const removeQueuedAgentMessage = useChatStore(s => s.removeQueuedAgentMessage);
  const clearQueuedAgentMessages = useChatStore(s => s.clearQueuedAgentMessages);
  const agentMessages = useChatStore(s => s.agentMessages);
  const agentWaiting = useChatStore(s => s.agentWaiting);
  const agentHasMore = useChatStore(s => s.agentHasMore);
  const agentCurrentProvider = useChatStore(s => s.agentCurrentProvider);
  const queuedMainMessages = useChatStore(
    s => s.queuedMainMessages[groupJid] || EMPTY_QUEUED_MESSAGES,
  );
  const queuedAgentMessages = useChatStore((s) => {
    if (!activeAgentTab) return EMPTY_QUEUED_MESSAGES;
    return s.queuedAgentMessages[activeAgentTab] || EMPTY_QUEUED_MESSAGES;
  });

  const currentUser = useAuthStore(s => s.user);
  const canManageSystemConfig = !!currentUser && (
    currentUser.role === 'admin' || currentUser.permissions.includes('manage_system_config')
  );
  const canUseTerminal = group?.execution_mode !== 'host';
  const isWorkspaceView =
    group.kind === 'home' ||
    group.kind === 'web' ||
    groupJid.startsWith('web:');
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Fetch IM connection status for home groups
  const isHome = !!group?.is_home;
  const isOwnHome =
    isHome &&
    (
      (!!group?.created_by && group.created_by === currentUser?.id) ||
      (currentUser?.role === 'admin' && group?.folder === 'main')
    );
  useEffect(() => {
    if (!isOwnHome) { setImStatus(null); return; }
    let active = true;
    const fetchStatus = () => {
      api.get<{ channels?: ImChannelStatusItem[] }>('/api/config/user-im/status')
        .then((data) => {
          if (!active) return;
          setImStatus(Array.isArray(data.channels) ? data.channels : []);
        })
        .catch(() => {});
    };
    fetchStatus();
    const timer = setInterval(fetchStatus, 30_000); // refresh every 30s
    return () => { active = false; clearInterval(timer); };
  }, [isOwnHome]);

  const loadWorkspaceSessionBindings = useCallback(async () => {
    if (!isWorkspaceView) {
      setWorkspaceSessions([]);
      return;
    }
    setBindingLoading(true);
    setBindingError(null);
    try {
      const data = await api.get<UserImSessionsResponse>('/api/config/user-im/sessions');
      setWorkspaceSessions(data.sessions || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('chat.view.errors.loadBindingFailed');
      setBindingError(message);
      setWorkspaceSessions([]);
    } finally {
      setBindingLoading(false);
    }
  }, [isWorkspaceView, t]);

  useEffect(() => {
    setBindingNotice(null);
    setBindingError(null);
    setSessionSavingByJid({});
    void loadWorkspaceSessionBindings();
  }, [groupJid, loadWorkspaceSessionBindings]);

  const bindSessionToCurrentWorkspace = useCallback(async (chatJid: string) => {
    if (!group?.folder) return;
    setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: true }));
    setBindingNotice(null);
    setBindingError(null);
    try {
      await api.put('/api/config/user-im/bindings', {
        chatJid,
        targetFolder: group.folder,
      });
      setBindingNotice(t('chat.view.notice.bindingSaved'));
      await Promise.all([loadWorkspaceSessionBindings(), loadGroups()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('chat.view.errors.saveBindingFailed');
      setBindingError(message);
    } finally {
      setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: false }));
    }
  }, [group?.folder, loadGroups, loadWorkspaceSessionBindings, t]);

  const resetSessionBinding = useCallback(async (chatJid: string) => {
    setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: true }));
    setBindingNotice(null);
    setBindingError(null);
    try {
      await api.delete(`/api/config/user-im/bindings/${encodeURIComponent(chatJid)}`);
      setBindingNotice(t('chat.view.notice.routeReset'));
      await Promise.all([loadWorkspaceSessionBindings(), loadGroups()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('chat.view.errors.resetBindingFailed');
      setBindingError(message);
    } finally {
      setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: false }));
    }
  }, [loadGroups, loadWorkspaceSessionBindings, t]);

  // Load messages on group select
  const hasMessages = !!groupMessages;
  useEffect(() => {
    if (groupJid && !hasMessages) {
      loadMessages(groupJid);
    }
  }, [groupJid, hasMessages, loadMessages]);

  // Poll for new messages — use setTimeout recursion to avoid request piling up
  // Pauses when the page is not visible to save resources
  useEffect(() => {
    let active = true;

    const schedulePoll = () => {
      if (!active || document.hidden) return;
      pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const poll = async () => {
      if (!active) return;
      try {
        await refreshMessages(groupJid);
      } catch { /* handled in store */ }
      schedulePoll();
    };

    const handleVisibility = () => {
      if (!document.hidden && active) {
        // Resume polling immediately when page becomes visible
        if (pollRef.current) clearTimeout(pollRef.current);
        poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    schedulePoll();

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupJid]);

  // Restore active agent state on WebSocket reconnect.
  // wsManager.connect() is initialized at AppLayout level.
  const restoreActiveState = useChatStore(s => s.restoreActiveState);
  useEffect(() => {
    restoreActiveState();
    const unsub = wsManager.on('connected', () => {
      restoreActiveState();
    });
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived: active agent info and kind
  const activeAgent = activeAgentTab ? agents.find(a => a.id === activeAgentTab) : null;
  const isConversationTab = activeAgent?.kind === 'conversation';
  const isSdkTask = !!activeAgentTab && !!sdkTasks[activeAgentTab];
  const sdkTaskIds = useMemo(() => new Set(Object.keys(sdkTasks)), [sdkTasks]);
  const connectedImChannels = useMemo(
    () => (imStatus ?? []).filter((item) => item.connected),
    [imStatus],
  );
  const inputCurrentProvider =
    activeAgentTab && isConversationTab
      ? (agentCurrentProvider[activeAgentTab] ?? group.effective_provider ?? 'claude')
      : (group.effective_provider ?? 'claude');
  const activeConversationBusy =
    !!(activeAgentTab && isConversationTab
      && (agentWaiting[activeAgentTab] || agentStreaming[activeAgentTab]));

  // Load sub-agents for this group
  useEffect(() => {
    loadAgents(groupJid);
  }, [groupJid, loadAgents]);

  // Load messages for conversation agent tabs
  useEffect(() => {
    if (activeAgentTab && isConversationTab) {
      const existing = agentMessages[activeAgentTab];
      if (!existing) {
        loadAgentMessages(groupJid, activeAgentTab);
      }
    }
  }, [activeAgentTab, isConversationTab, groupJid, loadAgentMessages, agentMessages]);

  useEffect(() => {
    if (!isWaiting) {
      void flushQueuedMainMessages(groupJid);
    }
  }, [groupJid, isWaiting, flushQueuedMainMessages]);

  useEffect(() => {
    if (activeAgentTab && isConversationTab && !activeConversationBusy) {
      void flushQueuedAgentMessages(groupJid, activeAgentTab);
    }
  }, [
    groupJid,
    activeAgentTab,
    isConversationTab,
    activeConversationBusy,
    flushQueuedAgentMessages,
  ]);

  // Subscribe to WebSocket streaming events.
  useEffect(() => {
    const unsub1 = wsManager.on('stream_event', (data: any) => {
      if (data.chatJid === groupJid) handleStreamEvent(groupJid, data.event, data.agentId);
    });
    // agent_reply as fallback: no-op if new_message already handled.
    const unsub2 = wsManager.on('agent_reply', (data: any) => {
      if (data.chatJid === groupJid) clearStreaming(groupJid);
    });
    // Push new_message into local state immediately to avoid poll lag.
    const unsub3 = wsManager.on('new_message', (data: any) => {
      if (data.chatJid === groupJid && data.message) {
        handleWsNewMessage(groupJid, data.message, data.agentId);
      }
    });
    // Sub-agent status updates.
    const unsub4 = wsManager.on('agent_status', (data: any) => {
      if (data.chatJid === groupJid) {
        handleAgentStatus(groupJid, data.agentId, data.status, data.name, data.prompt, data.resultSummary, data.kind);
      }
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [groupJid, handleStreamEvent, handleWsNewMessage, handleAgentStatus, clearStreaming]);

  const [scrollTrigger, setScrollTrigger] = useState(0);

  const handleSend = async (
    content: string,
    attachments?: Array<{ data: string; mimeType: string }>,
    options?: MessageInputSendOptions,
  ) => {
    await sendMessage(
      groupJid,
      content,
      attachments,
      options?.operationPermissionMode,
      options?.agentRuntimeOverride,
      options?.modelOverride,
      options?.reasoningEffort,
    );
    setScrollTrigger(n => n + 1);
  };

  const handleLoadMore = () => {
    if (hasMoreMessages && !loading) {
      loadMessages(groupJid, true);
    }
  };

  const handleResetSession = async () => {
    setResetLoading(true);
    await resetSession(groupJid);
    setResetLoading(false);
    setShowResetConfirm(false);
  };

  const handleWorkspaceRemoteAccess = async () => {
    if (!group?.folder || creatingRemoteAccessLink) return;

    setCreatingRemoteAccessLink(true);
    try {
      const data = await api.post<RemoteAccessLinkResponse>('/api/remote-access/links', {
        path: `/chat/${encodeURIComponent(group.folder)}`,
      });
      const url = data.link.url;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const message = err instanceof Error ? err.message : t('chat.view.errors.remoteAccessLinkFailed');
      window.alert(message);
    } finally {
      setCreatingRemoteAccessLink(false);
    }
  };

  // --- Drag resize handlers (mouse + touch) ---
  const startDrag = useCallback((startY: number) => {
    isDraggingRef.current = true;
    dragStartYRef.current = startY;
    dragStartHeightRef.current = terminalHeight;

    const calcHeight = (currentY: number) => {
      const delta = dragStartYRef.current - currentY;
      const maxHeight = containerRef.current
        ? containerRef.current.clientHeight * TERMINAL_MAX_RATIO
        : 600;
      return Math.min(maxHeight, Math.max(TERMINAL_MIN_HEIGHT, dragStartHeightRef.current + delta));
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      setTerminalHeight(calcHeight(e.clientY));
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!isDraggingRef.current) return;
      setTerminalHeight(calcHeight(e.touches[0].clientY));
    };

    const cleanup = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', cleanup);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', cleanup);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', cleanup);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [terminalHeight]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startDrag(e.clientY);
  }, [startDrag]);

  const handleTouchDragStart = useCallback((e: React.TouchEvent) => {
    startDrag(e.touches[0].clientY);
  }, [startDrag]);

  // Toggle terminal: desktop = bottom panel, mobile = modal
  const handleTerminalToggle = useCallback(() => {
    if (!canUseTerminal) return;
    // Use matchMedia to detect desktop vs mobile
    if (window.matchMedia('(min-width: 1024px)').matches) {
      if (!terminalMounted) {
        setTerminalMounted(true);
        setTerminalVisible(true);
      } else {
        setTerminalVisible(prev => !prev);
      }
    } else {
      setMobileTerminal(true);
    }
  }, [canUseTerminal, terminalMounted]);

  // Switching groups should not carry terminal UI/session into the next page.
  useEffect(() => {
    setTerminalVisible(false);
    setTerminalMounted(false);
    setMobileTerminal(false);
  }, [groupJid]);

  // If current group is host mode, force-close any mounted terminal.
  useEffect(() => {
    if (canUseTerminal) return;
    setTerminalVisible(false);
    setTerminalMounted(false);
    setMobileTerminal(false);
  }, [canUseTerminal]);

  const openMobileFiles = () => {
    setMobileActionsOpen(false);
    setMobilePanel('files');
  };

  const openMobileEnv = () => {
    setMobileActionsOpen(false);
    setMobilePanel('env');
  };

  if (!group) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">{t('chat.view.groupNotFound')}</p>
        </div>
      </div>
    );
  }

  const workflowRunning = group.workflow_status === 'running';
  const workflowStageProgress =
    group.workflow_stage_index && group.workflow_stage_total
      ? `${group.workflow_stage_index}/${group.workflow_stage_total}`
      : null;
  const workflowLabel = group.workflow_template_id
    ? [
      group.workflow_template_id,
      workflowStageProgress ? t('chat.view.workflow.stage', { value: workflowStageProgress }) : null,
      group.workflow_stage_name || null,
    ].filter(Boolean).join(' · ')
    : null;
  const workflowProvider = group.workflow_stage_provider;
  const workflowProviderDefault = group.workflow_stage_default_provider;
  const workflowProviderFallbackFrom = group.workflow_stage_fallback_from_provider;
  const workflowBlockedReason = group.workflow_blocked_reason?.trim() || null;
  const workflowProviderInFallback =
    !!workflowProvider
    && !!workflowProviderFallbackFrom
    && workflowProvider !== workflowProviderDefault;
  const workflowProviderLabel = workflowProvider
    ? (
      workflowProviderInFallback && workflowProviderFallbackFrom
        ? `${workflowProvider} ← ${workflowProviderFallbackFrom}`
        : workflowProvider
    )
    : null;
  const workflowControlsVisible = !activeAgentTab;
  const canManageMembers =
    (group.is_shared || group.member_role === 'owner') && !group.is_home;
  const sidebarTabs = useMemo(() => {
    const items = [
      {
        id: 'files' as SidebarTab,
        label: t('chat.view.sidebar.files'),
        subtitle: t('chat.view.sidebar.filesSubtitle'),
        icon: FolderOpen,
      },
      {
        id: 'env' as SidebarTab,
        label: t('chat.view.sidebar.env'),
        subtitle: t('chat.view.sidebar.envSubtitle'),
        icon: Wrench,
      },
      {
        id: 'skills' as SidebarTab,
        label: t('chat.view.sidebar.skills'),
        subtitle: t('chat.view.sidebar.skillsSubtitle'),
        icon: Sparkles,
      },
    ];
    if (canManageMembers) {
      items.push({
        id: 'members' as SidebarTab,
        label: t('chat.view.sidebar.members'),
        subtitle: t('chat.view.sidebar.membersSubtitle'),
        icon: Users,
      });
    }
    return items;
  }, [canManageMembers, t]);
  const activeSidebarMeta =
    sidebarTabs.find((item) => item.id === sidebarTab) ?? sidebarTabs[0];

  useEffect(() => {
    if (!sidebarTabs.some((item) => item.id === sidebarTab)) {
      setSidebarTab('files');
    }
  }, [sidebarTab, sidebarTabs]);

  const sendWorkflowCommand = async (command: string) => {
    await sendMessage(groupJid, command);
    setScrollTrigger((n) => n + 1);
  };

  const renderWorkspaceBindingsPanel = () => {
    if (!isWorkspaceView) {
      return (
        <div className="h-full flex items-center justify-center px-4 text-sm text-muted-foreground">
          {t('chat.view.bindings.notSupported')}
        </div>
      );
    }

    if (bindingLoading) {
      return (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          {t('chat.view.loading')}
        </div>
      );
    }

    return (
      <div className="app-canvas h-full overflow-y-auto p-4 space-y-3">
        <div className="text-xs text-muted-foreground">
          {t('chat.view.bindings.description', { folder: group.folder })}
        </div>
        {workspaceSessions.length === 0 ? (
          <div className="rounded-lg bg-muted/15 p-3 text-xs text-muted-foreground">
            {t('chat.view.bindings.empty')}
          </div>
        ) : (
          workspaceSessions.map((session) => {
            const isSaving = !!sessionSavingByJid[session.chatJid];
            const explicitToCurrent =
              !!session.binding?.enabled && session.binding.targetFolder === group.folder;
            return (
              <div
                key={session.chatJid}
                className={`space-y-2 rounded-lg p-3 ${
                  explicitToCurrent
                    ? 'border border-emerald-300 bg-emerald-50/70'
                    : 'bg-muted/10'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-foreground">
                    {session.channel === 'feishu' ? t('chat.view.bindings.feishu') : t('chat.view.bindings.telegram')}
                  </span>
                  <span className="text-sm font-medium text-foreground">{session.name}</span>
                  {explicitToCurrent && (
                    <span className="text-[11px] text-emerald-700">
                      {t('chat.view.bindings.boundToCurrent')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground break-all">{session.chatJid}</div>
                <div className="text-xs text-muted-foreground">
                  {t('chat.view.bindings.currentRoute')}
                  {session.mappedWorkspaceName && session.mappedFolder
                    ? ` ${session.mappedWorkspaceName} (${session.mappedFolder})`
                    : ` ${t('chat.view.bindings.unmapped')}`}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void bindSessionToCurrentWorkspace(session.chatJid)}
                    disabled={isSaving || explicitToCurrent}
                    className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100 disabled:opacity-60"
                  >
                    {isSaving && <Loader2 className="size-3.5 animate-spin" />}
                    {explicitToCurrent ? t('chat.view.bindings.bound') : t('chat.view.bindings.bindToCurrent')}
                  </button>
                  <button
                    onClick={() => void resetSessionBinding(session.chatJid)}
                    disabled={isSaving || !session.binding}
                    className="inline-flex items-center rounded-md border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                  >
                    {t('chat.view.bindings.resetDefault')}
                  </button>
                </div>
              </div>
            );
          })
        )}
        {bindingNotice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{bindingNotice}</div>}
        {bindingError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{bindingError}</div>}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border bg-card px-6">
        {onBack && (
          <button
            onClick={onBack}
            className="lg:hidden -ml-2 cursor-pointer rounded-lg border border-transparent p-2 text-muted-foreground transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
            aria-label={t('chat.view.actions.back')}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="truncate text-base font-bold tracking-tight text-foreground">{group.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-medium text-muted-foreground">
              {isWaiting
                ? t('chat.view.status.thinking')
                : group.is_home
                  ? t('chat.view.status.mainWorkspace')
                  : t('chat.view.status.workspace')}
            </span>
            {!isWaiting && group.is_shared && (
              <span className="inline-flex items-center gap-1 rounded-full border border-brand-200/70 bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                <Users className="h-3 w-3" />
                {t('chat.view.status.memberCount', { count: group.member_count ?? 0 })}
              </span>
            )}
            {!isWaiting && group.execution_mode && (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                group.execution_mode === 'host'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-sky-200 bg-sky-50 text-sky-700'
              }`}>
                {group.execution_mode === 'host'
                  ? t('chat.view.status.host')
                  : t('chat.view.status.docker')}
              </span>
            )}
            {isOwnHome && connectedImChannels.length > 0 && (
              connectedImChannels.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {item.displayName}
                </span>
              ))
            )}
          </div>
        </div>
        {isWorkspaceView && (
          <button
            onClick={() => setBindingsOpen(true)}
            className="hidden cursor-pointer items-center rounded-lg border border-border/80 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground lg:inline-flex"
          >
            {t('chat.view.bindings.title')}
          </button>
        )}
        {isWorkspaceView && canManageSystemConfig && (
          <button
            onClick={() => void handleWorkspaceRemoteAccess()}
            disabled={creatingRemoteAccessLink}
            className="hidden cursor-pointer items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-60 lg:inline-flex"
          >
            {creatingRemoteAccessLink
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Link className="size-3.5" />}
            {t('chat.view.actions.remoteAccess')}
          </button>
        )}
        {/* Desktop: toggle side panel */}
        <button
          onClick={() => setPanelOpen((v) => !v)}
          className="hidden cursor-pointer rounded-lg border border-border/70 p-2 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground lg:flex"
          title={panelOpen ? t('chat.view.actions.collapsePanel') : t('chat.view.actions.expandPanel')}
          aria-label={panelOpen ? t('chat.view.actions.collapsePanel') : t('chat.view.actions.expandPanel')}
        >
          {panelOpen ? <PanelRightClose className="w-5 h-5" /> : <PanelRightOpen className="w-5 h-5" />}
        </button>
        {/* Mobile only: condensed actions */}
        <div className="lg:hidden">
          <button
            onClick={() => setMobileActionsOpen(true)}
            className="cursor-pointer rounded-lg border border-border/70 p-2 text-muted-foreground transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
            title={t('chat.view.actions.more')}
            aria-label={t('chat.view.actions.more')}
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>

      {workflowLabel && (
        <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/70 px-4 py-1.5 text-xs text-brand-700">
          <span
            className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium ${
              workflowRunning ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'
            }`}
          >
            {workflowRunning ? t('chat.view.workflow.running') : (group.workflow_status || t('chat.view.workflow.fallback'))}
          </span>
          <span className="truncate">{workflowLabel}</span>
          {workflowProviderLabel && (
            <span
              className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium ${
                workflowProviderInFallback
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-sky-100 text-sky-700'
              }`}
            >
              {workflowProviderLabel}
            </span>
          )}
          {workflowControlsVisible && (
            <div className="ml-auto inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => void sendWorkflowCommand('/wf-status')}
                className="cursor-pointer rounded-md border border-brand-200/85 bg-card px-2 py-0.5 text-[11px] text-brand-700 transition-colors hover:bg-brand-50"
              >
                {t('chat.view.workflow.status')}
              </button>
              {workflowRunning && (
                <button
                  type="button"
                  onClick={() => void sendWorkflowCommand('/wf-next')}
                  className="cursor-pointer rounded-md border border-brand-200/85 bg-card px-2 py-0.5 text-[11px] text-brand-700 transition-colors hover:bg-brand-50"
                >
                  {t('chat.view.workflow.next')}
                </button>
              )}
              {workflowRunning && (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(t('chat.view.workflow.confirmExit'))) return;
                    void sendWorkflowCommand('/wf-exit');
                  }}
                  className="cursor-pointer rounded-md border border-rose-200/85 bg-card px-2 py-0.5 text-[11px] text-rose-600 transition-colors hover:bg-rose-50"
                >
                  {t('chat.view.workflow.exit')}
                </button>
              )}
            </div>
          )}
          {workflowBlockedReason && (
            <span className="w-full text-[11px] text-rose-600 truncate">
              {workflowBlockedReason}
            </span>
          )}
        </div>
      )}

      {/* IM channel setup banner for home container without IM */}
      {isOwnHome && imStatus && connectedImChannels.length === 0 && !imBannerDismissed && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50/90 px-4 py-2 text-sm text-amber-800">
          <Link className="h-4 w-4 flex-shrink-0" />
          <span className="min-w-0 flex-1">{t('chat.view.imBanner.message')}</span>
          <button
            onClick={() => navigate('/setup/channels')}
            className="flex-shrink-0 cursor-pointer rounded-md border border-amber-700/20 bg-amber-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
          >
            {t('chat.view.imBanner.goSetup')}
          </button>
          <button
            onClick={() => {
              setImBannerDismissed(true);
              localStorage.setItem('im-banner-dismissed', '1');
            }}
            className="flex-shrink-0 cursor-pointer rounded p-0.5 transition-colors hover:bg-amber-200/60"
            aria-label={t('chat.view.actions.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Agent tab bar */}
      <AgentTabBar
        agents={agents}
        activeTab={activeAgentTab}
        onSelectTab={(id) => setActiveAgentTab(groupJid, id)}
        onDeleteAgent={(id) => deleteAgentAction(groupJid, id)}
        sdkTaskIds={sdkTaskIds}
        onCreateConversation={() => {
          const name = prompt(t('chat.view.actions.newConversationPrompt'));
          if (name?.trim()) {
            createConversation(groupJid, name.trim()).then((agent) => {
              if (agent) setActiveAgentTab(groupJid, agent.id);
            });
          }
        }}
      />

      {/* Main Content: Messages + Sidebar */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          {activeAgentTab && isConversationTab ? (
            /* Conversation agent tab: interactive — user can send messages */
            <>
              <MessageList
                key={`conv-${activeAgentTab}`}
                messages={agentMessages[activeAgentTab] || []}
                loading={false}
                hasMore={!!agentHasMore[activeAgentTab]}
                onLoadMore={() => loadAgentMessages(groupJid, activeAgentTab, true)}
                scrollTrigger={scrollTrigger}
                groupJid={groupJid}
                isWaiting={!!agentWaiting[activeAgentTab] || !!agentStreaming[activeAgentTab]}
                onInterrupt={() => interruptQuery(`${groupJid}#agent:${activeAgentTab}`)}
                agentId={activeAgentTab}
              />
              <MessageInput
                onSend={async (content, _attachments, options) => {
                  sendAgentMessage(
                    groupJid,
                    activeAgentTab,
                    content,
                    options?.operationPermissionMode,
                    options?.agentRuntimeOverride,
                    options?.modelOverride,
                    options?.reasoningEffort,
                  );
                  setScrollTrigger(n => n + 1);
                }}
                groupJid={groupJid}
                currentProvider={inputCurrentProvider}
                queuedMessages={queuedAgentMessages}
                onRemoveQueuedMessage={(queuedMessageId) => removeQueuedAgentMessage(activeAgentTab, queuedMessageId)}
                onClearQueuedMessages={() => clearQueuedAgentMessages(activeAgentTab)}
              />
            </>
          ) : activeAgentTab ? (
            /* Task agent tab */
            <>
              {isSdkTask ? (
                /* SDK task: stream content or status feedback. */
                <div className="flex-1 overflow-y-auto p-4">
                  {(() => {
                    const streamState = agentStreaming[activeAgentTab];
                    const hasStreamContent = streamState && (
                      streamState.partialText
                      || streamState.thinkingText
                      || streamState.activeTools.length > 0
                      || !!streamState.activeHook
                      || !!streamState.systemStatus
                      || streamState.recentEvents.length > 0
                    );
                    const task = sdkTasks[activeAgentTab];
                    const taskStatus = task?.status;

                    if (taskStatus === 'completed') {
                      return (
                        <div className="text-center py-8 space-y-2">
                          <div className="text-sm font-medium text-emerald-600">
                            {t('chat.view.sdkTask.completed')}
                          </div>
                          {task?.summary && (
                            <div className="mx-auto max-w-md text-xs text-muted-foreground">{task.summary}</div>
                          )}
                        </div>
                      );
                    }

                    if (taskStatus === 'error') {
                      return (
                        <div className="text-center py-8 space-y-2">
                          <div className="text-sm font-medium text-red-600">
                            {t('chat.view.sdkTask.error')}
                          </div>
                          {task?.summary && (
                            <div className="mx-auto max-w-md text-xs text-muted-foreground">{task.summary}</div>
                          )}
                        </div>
                      );
                    }

                    if (hasStreamContent) {
                      // Streamed content available: render StreamingDisplay.
                      return (
                        <StreamingDisplay
                          groupJid={groupJid}
                          isWaiting={taskStatus === 'running'}
                          agentId={activeAgentTab}
                        />
                      );
                    }

                    // Running state: description + elapsed timer + background hint.
                    return (
                      <div className="flex flex-col items-center justify-center py-12 px-4 space-y-4">
                        {/* Animated spinner */}
                        <div className="relative">
                          <div className="h-12 w-12 rounded-full border-2 border-brand-100" />
                          <div className="absolute inset-0 h-12 w-12 animate-spin rounded-full border-2 border-transparent border-t-brand-500" />
                        </div>

                        <div className="text-center space-y-2 max-w-md">
                          <div className="text-sm font-medium text-foreground">
                            {t('chat.view.sdkTask.running')}
                          </div>
                          {task?.description && (
                            <div className="text-xs text-muted-foreground leading-relaxed">
                              {task.description}
                            </div>
                          )}
                        </div>

                        {/* Elapsed timer */}
                        {task?.startedAt && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {t('chat.view.sdkTask.elapsed')} <ElapsedTimer startTime={task.startedAt} />
                          </div>
                        )}

                        <div className="max-w-sm text-center text-[11px] leading-relaxed text-muted-foreground">
                          {t('chat.view.sdkTask.backgroundHint')}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                /* DB Task: read-only — show agent's messages from main chat */
                <MessageList
                  key={`task-${activeAgentTab}`}
                  messages={(groupMessages || []).filter(
                    (m) => m.sender === `agent:${activeAgentTab}`,
                  )}
                  loading={false}
                  hasMore={false}
                  onLoadMore={() => {}}
                  scrollTrigger={scrollTrigger}
                  groupJid={groupJid}
                  isWaiting={!!agentStreaming[activeAgentTab]}
                  onInterrupt={() => interruptQuery(groupJid)}
                  agentId={activeAgentTab}
                />
              )}
              {(() => {
                const activeSdkTask = activeAgentTab ? sdkTasks[activeAgentTab] : null;
                if (isSdkTask && activeSdkTask?.isTeammate && activeSdkTask?.status === 'running') {
                  return (
                    /* Teammate tab forwards messages via main conversation. */
                    <div className="border-t border-border">
                      <div className="bg-amber-50/70 px-4 pb-0.5 pt-1.5 text-center text-[10px] text-amber-700">
                        {t('chat.view.sdkTask.teammateForwardHint')}
                      </div>
                      <MessageInput
                        onSend={async (content, _attachments, options) => {
                          const taskDesc = (activeSdkTask?.description || 'Teammate').replace(/"/g, '\\"');
                          // Keep this forwarding wrapper stable (non-localized) as an internal routing hint.
                          const wrappedContent = `[Send to Teammate "${taskDesc}"]: ${content}`;
                          await sendMessage(
                            groupJid,
                            wrappedContent,
                            undefined,
                            options?.operationPermissionMode,
                            options?.agentRuntimeOverride,
                            options?.modelOverride,
                            options?.reasoningEffort,
                          );
                          setScrollTrigger(n => n + 1);
                        }}
                        groupJid={groupJid}
                      />
                    </div>
                  );
                }
                return (
                  <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
                    {isSdkTask
                      ? (activeSdkTask?.status === 'running'
                        ? t('chat.view.sdkTask.onlyMainWhenRunning')
                        : t('chat.view.sdkTask.onlyMainWhenFinished'))
                      : t('chat.view.sdkTask.onlyMainWhenRunning')}
                  </div>
                );
              })()}
            </>
          ) : (
            /* Main conversation tab */
            <>
              <MessageList
                key={`main-${groupJid}`}
                messages={groupMessages || []}
                loading={loading}
                hasMore={hasMoreMessages}
                onLoadMore={handleLoadMore}
                scrollTrigger={scrollTrigger}
                groupJid={groupJid}
                isWaiting={isWaiting}
                onInterrupt={() => interruptQuery(groupJid)}
                agents={agents}
                onAgentClick={(agentId) => setActiveAgentTab(groupJid, agentId)}
                onSend={(content) => handleSend(content)}
              />
              <MessageInput
                onSend={handleSend}
                groupJid={groupJid}
                currentProvider={inputCurrentProvider}
                workflowContext={{
                  status: group.workflow_status,
                  templateId: group.workflow_template_id,
                  stageName: group.workflow_stage_name,
                  stageProvider: group.workflow_stage_provider,
                }}
                queuedMessages={queuedMainMessages}
                onRemoveQueuedMessage={(queuedMessageId) => removeQueuedMainMessage(groupJid, queuedMessageId)}
                onClearQueuedMessages={() => clearQueuedMainMessages(groupJid)}
                onResetSession={() => setShowResetConfirm(true)}
                onToggleTerminal={canUseTerminal ? handleTerminalToggle : undefined}
              />
            </>
          )}
        </div>

        {/* Desktop: sidebar with tabs (collapsible) */}
        <div className={cn(
          "hidden flex-shrink-0 border-l border-sidebar-border bg-card transition-[width] duration-200 lg:flex lg:flex-col",
          panelOpen ? "w-72" : "w-0 overflow-hidden border-l-0"
        )}>
          {/* Tab bar */}
          <div className="border-b border-sidebar-border px-3 py-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/75">
              {t('chat.view.sidebar.title')}
            </p>
            <div className="flex items-center gap-1 rounded-[10px] border border-sidebar-border bg-background p-1">
              {sidebarTabs.map((tab) => {
                const Icon = tab.icon;
                const active = sidebarTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSidebarTab(tab.id)}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-card text-brand-700 shadow-sm'
                        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {activeSidebarMeta && (
            <div className="border-b border-sidebar-border px-4 py-3">
              <div className="flex items-center gap-2">
                <activeSidebarMeta.icon className="h-4 w-4 text-brand-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{activeSidebarMeta.label}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{activeSidebarMeta.subtitle}</p>
                </div>
              </div>
            </div>
          )}

          {/* Tab content */}
          <div className="flex-1 overflow-hidden bg-card">
            {sidebarTab === 'files' ? (
              <FilePanel groupJid={groupJid} />
            ) : sidebarTab === 'env' ? (
              <ContainerEnvPanel groupJid={groupJid} />
            ) : sidebarTab === 'members' ? (
              <GroupMembersPanel groupJid={groupJid} />
            ) : (
              <GroupSkillsPanel groupJid={groupJid} />
            )}
          </div>
        </div>
      </div>

      {/* Desktop: Bottom terminal panel with drag handle */}
      {canUseTerminal && terminalMounted && (
        <>
          {/* Drag handle */}
          {terminalVisible && (
            <div
              onMouseDown={handleDragStart}
              onTouchStart={handleTouchDragStart}
              className="hidden lg:flex h-1 bg-muted hover:bg-brand-400 cursor-row-resize items-center justify-center transition-colors group"
            >
              <div className="h-0.5 w-8 rounded-full bg-muted-foreground/60 transition-colors group-hover:bg-brand-500" />
            </div>
          )}
          {/* Terminal panel */}
          <div
            className={`hidden lg:block flex-shrink-0 overflow-hidden transition-[height] duration-200 ${
              terminalVisible ? 'border-t border-border' : 'border-t-0'
            }`}
            style={{ height: terminalVisible ? terminalHeight : 0 }}
          >
            <TerminalPanel
              groupJid={groupJid}
              visible={terminalVisible}
              onHide={() => setTerminalVisible(false)}
              onDelete={() => {
                setTerminalVisible(false);
                setTerminalMounted(false);
              }}
            />
          </div>
        </>
      )}

      {/* Mobile: file panel sheet */}
      <Sheet open={mobilePanel === 'files'} onOpenChange={(v) => !v && setMobilePanel(null)}>
        <SheetContent side="bottom" className="h-[82dvh] border-t border-border/80 bg-card/98 p-0">
          <SheetHeader className="border-b border-border/70 bg-muted/25 px-4 pb-2 pt-4">
            <SheetTitle>{t('chat.view.mobile.filesTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 h-[calc(82dvh-56px)] overflow-hidden">
            <FilePanel
              groupJid={groupJid}
              onClose={() => setMobilePanel(null)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: env config sheet */}
      <Sheet open={mobilePanel === 'env'} onOpenChange={(v) => !v && setMobilePanel(null)}>
        <SheetContent side="bottom" className="h-[82dvh] border-t border-border/80 bg-card/98 p-0">
          <SheetHeader className="border-b border-border/70 bg-muted/25 px-4 pb-2 pt-4">
            <SheetTitle>{t('chat.view.mobile.envTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 h-[calc(82dvh-56px)] overflow-hidden">
            <ContainerEnvPanel
              groupJid={groupJid}
              onClose={() => setMobilePanel(null)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: skills sheet */}
      <Sheet open={mobilePanel === 'skills'} onOpenChange={(v) => !v && setMobilePanel(null)}>
        <SheetContent side="bottom" className="h-[82dvh] border-t border-border/80 bg-card/98 p-0">
          <SheetHeader className="border-b border-border/70 bg-muted/25 px-4 pb-2 pt-4">
            <SheetTitle>{t('chat.view.mobile.skillsTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 h-[calc(82dvh-56px)] overflow-hidden">
            <GroupSkillsPanel
              groupJid={groupJid}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: members sheet */}
      <Sheet open={mobilePanel === 'members'} onOpenChange={(v) => !v && setMobilePanel(null)}>
        <SheetContent side="bottom" className="h-[82dvh] border-t border-border/80 bg-card/98 p-0">
          <SheetHeader className="border-b border-border/70 bg-muted/25 px-4 pb-2 pt-4">
            <SheetTitle>{t('chat.view.mobile.membersTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 h-[calc(82dvh-56px)] overflow-hidden">
            <GroupMembersPanel groupJid={groupJid} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: Terminal sheet */}
      <Sheet open={mobileTerminal} onOpenChange={(v) => !v && setMobileTerminal(false)}>
        <SheetContent side="bottom" className="h-[85dvh] border-t border-border/80 bg-card/98 p-0">
          <SheetHeader className="border-b border-border/70 bg-muted/25 px-4 pb-2 pt-4">
            <SheetTitle>{t('chat.view.mobile.terminalTitle')}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden h-[calc(85dvh-56px)]">
            <TerminalPanel
              groupJid={groupJid}
              visible
              onHide={() => setMobileTerminal(false)}
              onDelete={() => setMobileTerminal(false)}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* Mobile: Action Sheet */}
      <Sheet open={mobileActionsOpen} onOpenChange={(v) => !v && setMobileActionsOpen(false)}>
        <SheetContent side="bottom" className="border-t border-border/80 bg-card/98 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="border-b border-border/70 bg-muted/25 pb-2">
            <SheetTitle>{t('chat.view.mobile.actionsTitle')}</SheetTitle>
          </SheetHeader>
          <div className="space-y-2.5 pt-3">
            <button
              onClick={openMobileFiles}
              className="w-full cursor-pointer rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/70"
            >
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-brand-600" />
                <span className="text-sm font-medium text-foreground">{t('chat.view.mobile.files')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('chat.view.mobile.filesSubtitle')}</p>
            </button>
            <button
              onClick={openMobileEnv}
              className="w-full cursor-pointer rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/70"
            >
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-brand-600" />
                <span className="text-sm font-medium text-foreground">{t('chat.view.mobile.env')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('chat.view.mobile.envSubtitle')}</p>
            </button>
            <button
              onClick={() => { setMobileActionsOpen(false); setMobilePanel('skills'); }}
              className="w-full cursor-pointer rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/70"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-600" />
                <span className="text-sm font-medium text-foreground">{t('chat.view.mobile.skills')}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('chat.view.mobile.skillsSubtitle')}</p>
            </button>
            {isWorkspaceView && (
              <button
                onClick={() => { setMobileActionsOpen(false); setBindingsOpen(true); }}
                className="w-full cursor-pointer rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/70"
              >
                <div className="flex items-center gap-2">
                  <Link className="h-4 w-4 text-brand-600" />
                  <span className="text-sm font-medium text-foreground">{t('chat.view.bindings.title')}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('chat.view.mobile.bindingsSubtitle')}</p>
              </button>
            )}
            {canManageMembers && (
              <button
                onClick={() => { setMobileActionsOpen(false); setMobilePanel('members'); }}
                className="w-full cursor-pointer rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/70"
              >
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-brand-600" />
                  <span className="text-sm font-medium text-foreground">{t('chat.view.mobile.members')}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('chat.view.mobile.membersSubtitle')}</p>
              </button>
            )}
            {canUseTerminal && (
              <button
                onClick={() => {
                  setMobileActionsOpen(false);
                  setMobileTerminal(true);
                }}
                className="w-full cursor-pointer rounded-xl border border-border/80 bg-card px-3.5 py-3 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/70"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-brand-600" />
                  <span className="text-sm font-medium text-foreground">{t('chat.view.mobile.terminal')}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('chat.view.mobile.terminalSubtitle')}</p>
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={bindingsOpen} onOpenChange={setBindingsOpen}>
        <SheetContent side="right" className="w-full border-l border-border/80 bg-card/98 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border/70 bg-muted/25 px-4 pb-2 pt-4">
            <SheetTitle>{t('chat.view.bindings.title')}</SheetTitle>
          </SheetHeader>
          <div className="h-[calc(100dvh-56px)] overflow-hidden">
            {renderWorkspaceBindingsPanel()}
          </div>
        </SheetContent>
      </Sheet>

      {/* Reset session confirm dialog */}
      <ConfirmDialog
        open={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleResetSession}
        title={t('chat.view.reset.title')}
        message={t('chat.view.reset.message')}
        confirmText={t('chat.view.reset.confirm')}
        confirmVariant="danger"
        loading={resetLoading}
      />
    </div>
  );
}
