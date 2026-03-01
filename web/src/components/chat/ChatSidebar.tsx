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
import { useI18n } from '../../i18n';

interface ChatSidebarProps {
  className?: string;
}

const isImSessionKind = (kind?: string) => kind === 'feishu' || kind === 'telegram';

export function ChatSidebar({ className }: ChatSidebarProps) {
  const { t } = useI18n();
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
      { label: t('chat.chatSidebar.date.today'), items: [] },
      { label: t('chat.chatSidebar.date.recent7Days'), items: [] },
      { label: t('chat.chatSidebar.date.older'), items: [] },
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
  }, [workspaceGroups, searchQuery, t]);

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
      return t('chat.chatSidebar.clear.messageFallback', { name: clearState.name });
    }
    const isHost = group.execution_mode === 'host';
    const customCwd = group.custom_cwd?.trim();
    if (isHost && customCwd) {
      return t('chat.chatSidebar.clear.messageHostCustomCwd', {
        name: clearState.name,
        appName,
        customCwd,
      });
    }
    if (isHost) {
      return t('chat.chatSidebar.clear.messageHostDefaultCwd', {
        name: clearState.name,
        folder: group.folder,
      });
    }
    return t('chat.chatSidebar.clear.messageDocker', { name: clearState.name });
  };

  const buildDeleteMessage = () => {
    const group = deleteState.jid ? groups[deleteState.jid] : undefined;
    if (!group) {
      return t('chat.chatSidebar.delete.messageFallback', { name: deleteState.name });
    }
    const isHost = group.execution_mode === 'host';
    const customCwd = group.custom_cwd?.trim();
    if (isHost && customCwd) {
      return t('chat.chatSidebar.delete.messageHostCustomCwd', {
        name: deleteState.name,
        appName,
        customCwd,
      });
    }
    if (isHost) {
      return t('chat.chatSidebar.delete.messageHostDefaultCwd', {
        name: deleteState.name,
        folder: group.folder,
      });
    }
    return t('chat.chatSidebar.delete.messageDocker', { name: deleteState.name });
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
            <h2 className="truncate text-lg font-bold tracking-tight text-foreground">{t('chat.chatSidebar.title')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('chat.chatSidebar.workspaceCount', { count: totalWorkspaceCount })}</p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
            title={t('chat.chatSidebar.newWorkspace')}
            aria-label={t('chat.chatSidebar.newWorkspace')}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('chat.chatSidebar.searchPlaceholder')}
            className="h-10 w-full rounded-[10px] border-0 bg-background pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:bg-muted/65"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              aria-label={t('chat.chatSidebar.clearSearch')}
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
                  {t('chat.chatSidebar.mainWorkspaceSection')}
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
                title={searchQuery ? t('chat.chatSidebar.empty.noMatchTitle') : t('chat.chatSidebar.empty.noWorkspaceTitle')}
                description={
                  searchQuery
                    ? t('chat.chatSidebar.empty.noMatchDescription')
                    : t('chat.chatSidebar.empty.noWorkspaceDescription')
                }
                className="py-14"
              />
            ) : (
              <>
                {!hasWorkspaceMatches && !!searchQuery && mainGroup && (
                  <EmptyState
                    icon={FolderOpen}
                    title={t('chat.chatSidebar.empty.noMatchTitle')}
                    description={t('chat.chatSidebar.empty.mainStillAvailableDescription')}
                    className="py-10"
                  />
                )}

                {hasWorkspaceMatches && (
                  <section>
                    <p className="px-2 pb-1.5 pt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                      {t('chat.chatSidebar.workspaceSection')}
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
        title={t('chat.chatSidebar.clear.title')}
        message={buildClearHistoryMessage()}
        confirmText={t('chat.chatSidebar.clear.confirm')}
        cancelText={t('chat.chatSidebar.clear.cancel')}
        confirmVariant="danger"
        requireConfirmText={clearState.name}
        requireConfirmLabel={t('chat.chatSidebar.clear.requireConfirmLabel')}
        loading={clearLoading}
      />

      <ConfirmDialog
        open={deleteState.open}
        onClose={() => setDeleteState({ open: false, jid: '', name: '' })}
        onConfirm={handleDeleteConfirm}
        title={t('chat.chatSidebar.delete.title')}
        message={buildDeleteMessage()}
        confirmText={t('chat.chatSidebar.delete.confirm')}
        cancelText={t('chat.chatSidebar.delete.cancel')}
        confirmVariant="danger"
        requireConfirmText={deleteState.name}
        requireConfirmLabel={t('chat.chatSidebar.delete.requireConfirmLabel')}
        loading={deleteLoading}
      />
    </div>
  );
}
