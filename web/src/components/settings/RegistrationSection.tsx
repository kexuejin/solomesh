import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { api } from '../../api/client';
import { SettingsSwitch } from './SettingsSwitch';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface RegistrationSectionProps extends SettingsNotification {}

export function RegistrationSection({ setNotice, setError }: RegistrationSectionProps) {
  const { locale, t } = useI18n();
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [requireInviteCode, setRequireInviteCode] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ allowRegistration: boolean; requireInviteCode: boolean; updatedAt: string | null }>('/api/config/registration');
      setAllowRegistration(data.allowRegistration);
      setRequireInviteCode(data.requireInviteCode);
      setUpdatedAt(data.updatedAt);
    } catch {
      // ignore — keep defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const saveConfig = useCallback(async (allow: boolean, invite: boolean) => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const data = await api.put<{ allowRegistration: boolean; requireInviteCode: boolean; updatedAt: string | null }>('/api/config/registration', {
        allowRegistration: allow,
        requireInviteCode: invite,
      });
      setAllowRegistration(data.allowRegistration);
      setRequireInviteCode(data.requireInviteCode);
      setUpdatedAt(data.updatedAt);
      setNotice(t('settings.registration.notice.saved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.registration.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  }, [setNotice, setError, t]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('settings.registration.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        {t('settings.registration.description')}
      </div>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('settings.registration.headerBadge')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.registration.headerTitle')}</div>
        </div>

        <div className="space-y-3 px-4 py-4">
          {saving && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('settings.registration.saving')}
            </div>
          )}

          <div className="rounded-lg flex items-center justify-between gap-4 bg-muted/10 px-3 py-3">
            <div>
              <div className="text-sm font-medium text-foreground">{t('settings.registration.allowTitle')}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t('settings.registration.allowHint')}</div>
            </div>
            <SettingsSwitch
              checked={allowRegistration}
              disabled={saving}
              onCheckedChange={(next) => saveConfig(next, requireInviteCode)}
              ariaLabel={t('settings.registration.allowAria')}
            />
          </div>

          <div className="rounded-lg flex items-center justify-between gap-4 bg-muted/10 px-3 py-3">
            <div>
              <div className="text-sm font-medium text-foreground">{t('settings.registration.inviteTitle')}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{t('settings.registration.inviteHint')}</div>
            </div>
            <SettingsSwitch
              checked={requireInviteCode}
              disabled={saving}
              onCheckedChange={(next) => saveConfig(allowRegistration, next)}
              ariaLabel={t('settings.registration.inviteAria')}
            />
          </div>

          <SettingsMetaGrid
            columns={1}
            items={[
              {
                label: t('settings.registration.lastSaved'),
                value: updatedAt
                  ? new Date(updatedAt).toLocaleString(localeForDateTime(locale))
                  : t('settings.registration.notRecorded'),
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
