import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Trash2 } from 'lucide-react';

import { useAuthStore } from '../../stores/auth';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import type { SessionInfo, SettingsNotification } from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface SecuritySectionProps extends SettingsNotification {}

export function SecuritySection({ setNotice, setError }: SecuritySectionProps) {
  const { logout } = useAuthStore();
  const { locale, t } = useI18n();
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
      setNotice(t('settings.security.notice.sessionRevoked'));
      loadSessions();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.security.errors.actionFailed')));
    }
  };

  const handleLogout = () => {
    if (confirm(t('settings.security.confirmLogout'))) logout();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-200/80 bg-brand-50/55 px-4 py-3 text-sm text-foreground/85">
        {t('settings.security.description')}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.security.sessionsBadge')}</div>
            <div className="mt-1 text-sm font-medium text-foreground">{t('settings.security.sessionsTitle')}</div>
          </div>
          <Button variant="outline" onClick={loadSessions} disabled={loading} className="h-10 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? t('settings.security.refreshing') : t('settings.security.refresh')}
          </Button>
        </div>

        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
              {t('settings.security.empty')}
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
                      {s.user_agent?.split(' ').slice(0, 3).join(' ') || t('settings.security.unknownDevice')}
                    </span>
                    {s.is_current && (
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        {t('settings.security.currentDevice')}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t('settings.security.sessionMeta', {
                      ip: s.ip_address || t('settings.security.unknown'),
                      lastActive: new Date(s.last_active_at).toLocaleString(localeForDateTime(locale)),
                    })}
                  </div>
                </div>
                {!s.is_current && (
                  <button
                    onClick={() => handleRevoke(s.id)}
                    className="cursor-pointer rounded-xl p-2 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                    title={t('settings.security.revokeSession')}
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
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.security.accountBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.security.logoutTitle')}</div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/70 px-3 py-3">
          <div>
            <div className="text-sm font-medium text-red-800">{t('settings.security.logoutCardTitle')}</div>
            <div className="mt-0.5 text-xs text-red-700/85">{t('settings.security.logoutHint')}</div>
          </div>
          <Button variant="destructive" onClick={handleLogout} className="h-10 rounded-xl">
            {t('settings.security.logoutButton')}
          </Button>
        </div>
      </section>
    </div>
  );
}
