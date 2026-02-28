import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { GroupInfo } from '../../stores/groups';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { useGroupsStore } from '../../stores/groups';
import { useChatStore } from '../../stores/chat';

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

interface UserImWorkspace {
  folder: string;
  name: string;
  is_home: boolean;
}

interface UserImSessionsResponse {
  sessions: UserImSession[];
  workspaces: UserImWorkspace[];
}

interface GroupDetailProps {
  group: GroupInfo & { jid: string };
}

export function GroupDetail({ group }: GroupDetailProps) {
  const formatDate = (timestamp: string | number) => {
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isImSession =
    group.kind === 'feishu' ||
    group.kind === 'telegram' ||
    group.jid.startsWith('feishu:') ||
    group.jid.startsWith('telegram:');
  const isWorkspace =
    group.kind === 'home' ||
    group.kind === 'web' ||
    group.jid.startsWith('web:');
  const [bindingLoading, setBindingLoading] = useState(false);
  const [bindingSaving, setBindingSaving] = useState(false);
  const [bindingError, setBindingError] = useState<string | null>(null);
  const [bindingNotice, setBindingNotice] = useState<string | null>(null);
  const [sessionBindingInfo, setSessionBindingInfo] = useState<UserImSession | null>(null);
  const [allImSessions, setAllImSessions] = useState<UserImSession[]>([]);
  const [workspaces, setWorkspaces] = useState<UserImWorkspace[]>([]);
  const [targetFolder, setTargetFolder] = useState('');
  const [sessionSavingByJid, setSessionSavingByJid] = useState<Record<string, boolean>>({});
  const reloadGroups = useGroupsStore((state) => state.loadGroups);
  const reloadChatGroups = useChatStore((state) => state.loadGroups);

  const loadBindingContext = useCallback(async () => {
    if (!isImSession && !isWorkspace) return;

    setBindingLoading(true);
    setBindingError(null);
    try {
      const data = await api.get<UserImSessionsResponse>('/api/config/user-im/sessions');
      setAllImSessions(data.sessions || []);
      setWorkspaces(data.workspaces || []);
      const current = (data.sessions || []).find((item) => item.chatJid === group.jid) || null;
      setSessionBindingInfo(current);
      setTargetFolder(
        current?.binding?.targetFolder ||
          current?.mappedFolder ||
          group.im_binding_target_folder ||
          '',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : '加载会话绑定信息失败';
      setBindingError(message);
      setSessionBindingInfo(null);
      setAllImSessions([]);
      setWorkspaces([]);
    } finally {
      setBindingLoading(false);
    }
  }, [group.im_binding_target_folder, group.jid, isImSession, isWorkspace]);

  useEffect(() => {
    loadBindingContext();
  }, [loadBindingContext]);

  const handleSaveBinding = async () => {
    const nextFolder = targetFolder.trim();
    if (!nextFolder) {
      setBindingError('请选择目标工作区');
      return;
    }

    setBindingSaving(true);
    setBindingError(null);
    setBindingNotice(null);
    try {
      await api.put('/api/config/user-im/bindings', {
        chatJid: group.jid,
        targetFolder: nextFolder,
      });
      setBindingNotice('会话绑定已保存');
      await loadBindingContext();
      await Promise.all([reloadGroups(), reloadChatGroups()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存会话绑定失败';
      setBindingError(message);
    } finally {
      setBindingSaving(false);
    }
  };

  const handleBindSessionToCurrentWorkspace = async (chatJid: string) => {
    setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: true }));
    setBindingError(null);
    setBindingNotice(null);
    try {
      await api.put('/api/config/user-im/bindings', {
        chatJid,
        targetFolder: group.folder,
      });
      setBindingNotice('会话绑定已保存');
      await loadBindingContext();
      await Promise.all([reloadGroups(), reloadChatGroups()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存会话绑定失败';
      setBindingError(message);
    } finally {
      setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: false }));
    }
  };

  const handleResetSessionBinding = async (chatJid: string) => {
    setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: true }));
    setBindingError(null);
    setBindingNotice(null);
    try {
      await api.delete(`/api/config/user-im/bindings/${encodeURIComponent(chatJid)}`);
      setBindingNotice('会话已恢复默认路由');
      await loadBindingContext();
      await Promise.all([reloadGroups(), reloadChatGroups()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '恢复默认路由失败';
      setBindingError(message);
    } finally {
      setSessionSavingByJid((prev) => ({ ...prev, [chatJid]: false }));
    }
  };

  const handleResetBinding = async () => {
    setBindingSaving(true);
    setBindingError(null);
    setBindingNotice(null);
    try {
      await api.delete(`/api/config/user-im/bindings/${encodeURIComponent(group.jid)}`);
      setBindingNotice('会话已恢复默认路由');
      await loadBindingContext();
      await Promise.all([reloadGroups(), reloadChatGroups()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : '恢复默认路由失败';
      setBindingError(message);
    } finally {
      setBindingSaving(false);
    }
  };

  return (
    <div className="surface-card-soft space-y-3 p-4">
      {/* JID */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">完整 JID</div>
        <code className="block text-xs font-mono bg-card px-3 py-2 rounded border border-border break-all">
          {group.jid}
        </code>
      </div>

      {/* Folder */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">文件夹</div>
        <div className="text-sm text-foreground font-medium">{group.folder}</div>
      </div>

      {/* Added At */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">添加时间</div>
        <div className="text-sm text-foreground">
          {formatDate(group.added_at)}
        </div>
      </div>

      {/* Last Message */}
      {group.lastMessage && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">最后消息</div>
          <div className="text-sm text-foreground/80 bg-card px-3 py-2 rounded border border-border line-clamp-3 break-words">
            {group.lastMessage}
          </div>
          {group.lastMessageTime && (
            <div className="text-xs text-muted-foreground/80 mt-1">
              {formatDate(group.lastMessageTime)}
            </div>
          )}
        </div>
      )}

      {isWorkspace && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground mb-1">工作区内消息会话绑定</div>
          {bindingLoading ? (
            <div className="text-xs text-muted-foreground">加载中...</div>
          ) : allImSessions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              暂无可绑定的消息会话，先在飞书或 Telegram 发送一条消息。
            </div>
          ) : (
            <div className="space-y-2">
              {allImSessions.map((session) => {
                const isSaving = !!sessionSavingByJid[session.chatJid];
                const explicitToCurrent =
                  !!session.binding?.enabled && session.binding.targetFolder === group.folder;
                return (
                  <div
                    key={session.chatJid}
                    className={`rounded-md border p-2 ${
                      explicitToCurrent
                        ? 'border-emerald-300 bg-emerald-50/40'
                        : 'border-border/70 bg-card'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] px-2 py-0.5 rounded border border-border bg-muted/40 text-foreground/80">
                        {session.channel === 'feishu' ? '飞书' : 'Telegram'}
                      </span>
                      <span className="text-xs font-medium text-foreground">{session.name}</span>
                      {explicitToCurrent && (
                        <span className="text-[11px] text-emerald-700">已绑定到当前工作区</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground break-all mt-1">{session.chatJid}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      当前路由：
                      {session.mappedWorkspaceName && session.mappedFolder
                        ? ` ${session.mappedWorkspaceName} (${session.mappedFolder})`
                        : ' 未映射'}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={() => handleBindSessionToCurrentWorkspace(session.chatJid)}
                        disabled={isSaving || explicitToCurrent}
                      >
                        {isSaving && <Loader2 className="size-3.5 animate-spin" />}
                        {explicitToCurrent ? '已绑定' : '绑定到当前工作区'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResetSessionBinding(session.chatJid)}
                        disabled={isSaving || !session.binding}
                      >
                        恢复默认
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {isImSession && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground mb-1">会话绑定</div>
          {bindingLoading ? (
            <div className="text-xs text-muted-foreground">加载中...</div>
          ) : (
            <>
              {sessionBindingInfo ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    当前路由：
                    {sessionBindingInfo.mappedWorkspaceName && sessionBindingInfo.mappedFolder
                      ? ` ${sessionBindingInfo.mappedWorkspaceName} (${sessionBindingInfo.mappedFolder})`
                      : ' 未映射'}
                  </div>
                  <div className="flex flex-col gap-2">
                    <select
                      className="h-9 rounded-md border border-border bg-card px-3 text-sm text-foreground disabled:opacity-60"
                      value={targetFolder}
                      disabled={bindingSaving || workspaces.length === 0}
                      onChange={(e) => setTargetFolder(e.target.value)}
                    >
                      <option value="" disabled>
                        选择目标工作区
                      </option>
                      {workspaces.map((workspace) => (
                        <option key={workspace.folder} value={workspace.folder}>
                          {workspace.name} ({workspace.folder})
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveBinding}
                        disabled={bindingSaving || !targetFolder}
                      >
                        {bindingSaving && <Loader2 className="size-3.5 animate-spin" />}
                        保存绑定
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleResetBinding}
                        disabled={bindingSaving || !sessionBindingInfo.binding}
                      >
                        恢复默认
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  当前账号暂无该会话的绑定管理权限，请联系管理员或在对应工作区页面处理。
                </div>
              )}
              {bindingNotice && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700">
                  {bindingNotice}
                </div>
              )}
              {bindingError && (
                <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                  {bindingError}
                </div>
              )}
              <Link
                to="/settings?tab=my-channels"
                className="inline-flex items-center rounded-md border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted"
              >
                消息通道设置
              </Link>
            </>
          )}
        </div>
      )}

      {/* Note */}
      <div className="text-xs text-muted-foreground/80 pt-2 border-t border-border">
        其他群组配置暂不支持编辑
      </div>
    </div>
  );
}
