import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, Search, X } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { useAuthStore } from '../../stores/auth';
import { ConfirmDialog, EmptyState } from '@/components/common';
import { ChatGroupItem } from './ChatGroupItem';
import { CreateContainerDialog } from './CreateContainerDialog';
import { RenameDialog } from './RenameDialog';
import { EditWorkspaceDirectoryDialog } from './EditWorkspaceDirectoryDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ChatSidebarProps {
  className?: string;
}

const isImSessionKind = (kind?: string) => kind === 'feishu' || kind === 'telegram';

export function ChatSidebar({ className }: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Rename dialog state
  const [renameState, setRenameState] = useState({ open: false, jid: '', name: '' });

  // Delete confirm state
  const [deleteState, setDeleteState] = useState({ open: false, jid: '', name: '' });
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Edit workspace directory dialog state (host mode only)
  const [cwdState, setCwdState] = useState<{ open: boolean; jid: string; name: string; customCwd?: string }>({
    open: false,
    jid: '',
    name: '',
    customCwd: undefined,
  });

  // Clear history confirm state
  const [clearState, setClearState] = useState({ open: false, jid: '', name: '' });
  const [clearLoading, setClearLoading] = useState(false);

  const {
    groups,
    currentGroup,
    selectGroup,
    loadGroups,
    loading,
    deleteFlow,
    clearHistory,
  } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Separate home group / workspaces, sort by time
  const { mainGroup, workspaceGroups } = useMemo(() => {
    let main: (typeof groups)[string] & { jid: string } | null = null;
    const workspaces: ((typeof groups)[string] & { jid: string })[] = [];

    for (const [jid, info] of Object.entries(groups)) {
      const entry = { jid, ...info };
      if (info.is_my_home) {
        main = entry;
      } else if (!isImSessionKind(info.kind)) {
        workspaces.push(entry);
      }
    }

    const sortByRecent = (
      a: (typeof groups)[string] & { jid: string },
      b: (typeof groups)[string] & { jid: string }
    ) => {
      const timeA = a.lastMessageTime || a.added_at;
      const timeB = b.lastMessageTime || b.added_at;
      return new Date(timeB).getTime() - new Date(timeA).getTime();
    };
    workspaces.sort(sortByRecent);
    return { mainGroup: main, workspaceGroups: workspaces };
  }, [groups]);

  // Group non-main items by date period
  const groupedByDate = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 86400000);

    const sections: { label: string; items: typeof workspaceGroups }[] = [
      { label: '今天', items: [] },
      { label: '最近 7 天', items: [] },
      { label: '更早', items: [] },
    ];

    const filtered = searchQuery.trim()
      ? workspaceGroups.filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : workspaceGroups;

    filtered.forEach((g) => {
      const time = new Date(g.lastMessageTime || g.added_at);
      if (time >= today) sections[0].items.push(g);
      else if (time >= weekAgo) sections[1].items.push(g);
      else sections[2].items.push(g);
    });

    return sections.filter((s) => s.items.length > 0);
  }, [workspaceGroups, searchQuery]);

  const handleGroupSelect = (jid: string, folder: string) => {
    selectGroup(jid);
    navigate(`/chat/${folder}`);
  };

  const appearance = useAuthStore((s) => s.appearance);
  const appName = appearance?.appName || 'SoloMesh';

  const handleCreated = (jid: string, folder: string) => {
    selectGroup(jid);
    navigate(`/chat/${folder}`);
  };

  const handleDeleteConfirm = async () => {
    setDeleteLoading(true);
    try {
      await deleteFlow(deleteState.jid);
      setDeleteState({ open: false, jid: '', name: '' });
      // Navigate to the auto-selected next group, or list view if none remain
      const nextJid = useChatStore.getState().currentGroup;
      const nextFolder = nextJid ? useChatStore.getState().groups[nextJid]?.folder : null;
      navigate(nextFolder ? `/chat/${nextFolder}` : '/chat');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleClearConfirm = async () => {
    setClearLoading(true);
    try {
      const ok = await clearHistory(clearState.jid);
      if (ok) setClearState({ open: false, jid: '', name: '' });
    } finally {
      setClearLoading(false);
    }
  };

  const allGroups = mainGroup ? [mainGroup, ...workspaceGroups] : workspaceGroups;
  const totalWorkspaceCount = allGroups.length;
  const hasWorkspaceMatches = groupedByDate.length > 0;

  const buildClearHistoryMessage = () => {
    const group = clearState.jid ? groups[clearState.jid] : undefined;
    if (!group) {
      return `确认重建工作区「${clearState.name}」吗？此操作不可撤销。`;
    }
    const isHost = group.execution_mode === 'host';
    const customCwd = group.custom_cwd?.trim();
    if (isHost && customCwd) {
      return `确认重建工作区「${clearState.name}」吗？这会清除聊天记录、上下文和 SoloMesh 内部缓存，但不会删除外部目录「${customCwd}」中的文件。此操作不可撤销。`;
    }
    if (isHost) {
      return `确认重建工作区「${clearState.name}」吗？这会清除聊天记录、上下文，并重置默认工作目录（data/groups/${group.folder}/）中的文件。此操作不可撤销。`;
    }
    return `确认重建工作区「${clearState.name}」吗？这会清除全部聊天记录、上下文，并删除工作目录中的所有文件。此操作不可撤销。`;
  };

  const buildDeleteMessage = () => {
    const group = deleteState.jid ? groups[deleteState.jid] : undefined;
    if (!group) {
      return `确认删除工作区「${deleteState.name}」吗？此操作不可撤销。`;
    }
    const isHost = group.execution_mode === 'host';
    const customCwd = group.custom_cwd?.trim();
    if (isHost && customCwd) {
      return `确认删除工作区「${deleteState.name}」吗？此操作会删除该工作区在 SoloMesh 内的聊天记录、会话和定时任务，但不会删除外部目录「${customCwd}」中的文件。此操作不可撤销。`;
    }
    if (isHost) {
      return `确认删除工作区「${deleteState.name}」吗？此操作会删除该工作区的聊天记录、会话、定时任务，以及默认工作目录（data/groups/${group.folder}/）中的文件。此操作不可撤销。`;
    }
    return `确认删除工作区「${deleteState.name}」吗？此操作会彻底删除该工作区的全部数据，包括聊天记录、工作目录文件和定时任务。此操作不可撤销。`;
  };

  return (
    <div className={cn('flex h-full flex-col border-r border-sidebar-border bg-card', className)}>
      {/* Logo Header — only on mobile (PC has NavRail logo) */}
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-4 lg:hidden">
        <img
          src={`${import.meta.env.BASE_URL}icons/icon-192.png`}
          alt={appName}
          className="h-8 w-8 rounded-lg ring-1 ring-border/70"
        />
        <span className="truncate text-lg font-bold text-foreground">{appName}</span>
      </div>

      <div className="border-b border-sidebar-border px-6 pb-5 pt-6">
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-tight text-foreground">Workspace</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{totalWorkspaceCount} 个工作区</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            title="新工作区"
            aria-label="新工作区"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索工作区..."
            className="h-10 w-full rounded-[10px] border-0 bg-background pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-muted/65"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              aria-label="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Groups List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && allGroups.length === 0 ? (
          <div className="space-y-2 px-1 pt-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : (
          <>
            {/* Section: Home container */}
            {mainGroup && (
              <section className="mb-2 pt-2">
                <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  主工作区
                </p>
                <ChatGroupItem
                  jid={mainGroup.jid}
                  name={mainGroup.name}
                  folder={mainGroup.folder}
                  lastMessage={mainGroup.lastMessage}
                  executionMode={mainGroup.execution_mode}
                  customCwd={mainGroup.custom_cwd}
                  isImSession={isImSessionKind(mainGroup.kind)}
                  isBoundSession={!!mainGroup.im_binding_enabled}
                  isActive={currentGroup === mainGroup.jid}
                  isHome
                  editable
                  onSelect={handleGroupSelect}
                  onRename={(jid, name) => setRenameState({ open: true, jid, name })}
                  onEditDirectory={(jid, name, customCwd) =>
                    setCwdState({ open: true, jid, name, customCwd })
                  }
                  onClearHistory={(jid, name) => setClearState({ open: true, jid, name })}
                />
              </section>
            )}

            {/* Empty state */}
            {!hasWorkspaceMatches && !mainGroup ? (
              <EmptyState
                icon={FolderOpen}
                title={searchQuery ? '未找到匹配工作区' : '暂无工作区'}
                description={searchQuery ? '试试更短的关键词，或先创建一个工作区。' : '创建第一个工作区后，可以开始对话和任务编排。'}
                className="py-14"
              />
            ) : (
              <>
                {!hasWorkspaceMatches && !!searchQuery && mainGroup && (
                  <EmptyState
                    icon={FolderOpen}
                    title="未找到匹配工作区"
                    description="主工作区仍可继续使用，或清空搜索查看全部列表。"
                    className="py-10"
                  />
                )}

                {hasWorkspaceMatches && (
                  <section>
                    <p className="px-2 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                      工作区
                    </p>
                    {groupedByDate.map((section) => (
                      <div key={section.label} className="mb-2">
                        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground/75">
                          {section.label}
                        </p>
                        {section.items.map((g) => (
                          <ChatGroupItem
                            key={g.jid}
                            jid={g.jid}
                            name={g.name}
                            folder={g.folder}
                            lastMessage={g.lastMessage}
                            executionMode={g.execution_mode}
                            customCwd={g.custom_cwd}
                            isImSession={false}
                            isBoundSession={!!g.im_binding_enabled}
                            isActive={currentGroup === g.jid}
                            isHome={false}
                            editable={g.editable}
                            deletable={g.deletable}
                            onSelect={handleGroupSelect}
                            onRename={(jid, name) => setRenameState({ open: true, jid, name })}
                            onEditDirectory={(jid, name, customCwd) =>
                              setCwdState({ open: true, jid, name, customCwd })
                            }
                            onClearHistory={(jid, name) => setClearState({ open: true, jid, name })}
                            onDelete={(jid, name) => setDeleteState({ open: true, jid, name })}
                          />
                        ))}
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Dialogs */}
      <CreateContainerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      <RenameDialog
        open={renameState.open}
        jid={renameState.jid}
        currentName={renameState.name}
        onClose={() => setRenameState({ open: false, jid: '', name: '' })}
      />

      <EditWorkspaceDirectoryDialog
        open={cwdState.open}
        jid={cwdState.jid}
        currentName={cwdState.name}
        currentCwd={cwdState.customCwd}
        onClose={() => setCwdState({ open: false, jid: '', name: '', customCwd: undefined })}
      />

      <ConfirmDialog
        open={clearState.open}
        onClose={() => setClearState({ open: false, jid: '', name: '' })}
        onConfirm={handleClearConfirm}
        title="重建工作区"
        message={buildClearHistoryMessage()}
        confirmText="确认重建"
        cancelText="取消"
        confirmVariant="danger"
        requireConfirmText={clearState.name}
        requireConfirmLabel="请输入工作区名称以确认重建"
        loading={clearLoading}
      />

      <ConfirmDialog
        open={deleteState.open}
        onClose={() => setDeleteState({ open: false, jid: '', name: '' })}
        onConfirm={handleDeleteConfirm}
        title="删除工作区"
        message={buildDeleteMessage()}
        confirmText="删除"
        cancelText="取消"
        confirmVariant="danger"
        requireConfirmText={deleteState.name}
        requireConfirmLabel="请输入工作区名称以确认删除"
        loading={deleteLoading}
      />
    </div>
  );
}
