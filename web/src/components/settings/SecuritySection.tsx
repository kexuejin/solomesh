import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import type { SessionInfo, SettingsNotification } from './types';
import { getErrorMessage } from './types';

interface SecuritySectionProps extends SettingsNotification {}

export function SecuritySection({ setNotice, setError }: SecuritySectionProps) {
  const { logout } = useAuthStore();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ sessions: SessionInfo[] }>('/api/auth/sessions');
      setSessions(data.sessions);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleRevoke = async (id: string) => {
    try {
      await api.delete(`/api/auth/sessions/${id}`);
      setNotice('登录会话已撤销');
      loadSessions();
    } catch (err) {
      setError(getErrorMessage(err, '操作失败'));
    }
  };

  const handleLogout = () => {
    if (confirm('确定要退出登录吗？')) logout();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-200/80 bg-brand-50/55 px-4 py-3 text-sm text-foreground/85">
        当前页用于管理登录设备与会话安全。撤销会话后，对应设备需要重新登录。
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">设备会话</div>
            <div className="mt-1 text-sm font-medium text-foreground">登录设备</div>
          </div>
          <Button variant="outline" onClick={loadSessions} disabled={loading} className="h-10 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? '刷新中...' : '刷新'}
          </Button>
        </div>

        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
              暂无会话
            </div>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="max-w-xs truncate font-medium text-foreground">
                      {s.user_agent?.split(' ').slice(0, 3).join(' ') || '未知设备'}
                    </span>
                    {s.is_current && (
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        当前设备
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    IP: {s.ip_address || '未知'} · 最后活跃: {new Date(s.last_active_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                {!s.is_current && (
                  <button
                    onClick={() => handleRevoke(s.id)}
                    className="cursor-pointer rounded-xl p-2 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                    title="撤销会话"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="space-y-3 border-t border-border/70 pt-5">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">账户操作</div>
          <div className="mt-1 text-sm font-medium text-foreground">退出登录</div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/70 px-3 py-3">
          <div>
            <div className="text-sm font-medium text-red-800">退出当前账户</div>
            <div className="mt-0.5 text-xs text-red-700/85">退出后将返回登录页面，可随时重新登录。</div>
          </div>
          <Button variant="destructive" onClick={handleLogout} className="h-10 rounded-xl">
            退出登录
          </Button>
        </div>
      </section>
    </div>
  );
}
