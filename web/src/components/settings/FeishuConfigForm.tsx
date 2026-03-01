import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { SettingsSwitch } from './SettingsSwitch';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { FeishuConfigPublic, SettingsNotification } from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface FeishuConfigFormProps extends SettingsNotification {}

export function FeishuConfigForm({ setNotice, setError }: FeishuConfigFormProps) {
  const { locale, t } = useI18n();
  const [config, setConfig] = useState<FeishuConfigPublic | null>(null);
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<FeishuConfigPublic>('/api/config/feishu');
      setConfig(data);
      setAppId(data.appId || '');
      setAppSecret('');
      setClearSecret(false);
      setEnabled(data.enabled);
    } catch (err) {
      setError(getErrorMessage(err, t('settings.feishu.errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [setError, t]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleToggle = async (newEnabled: boolean) => {
    setToggling(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await api.put<FeishuConfigPublic>('/api/config/feishu', { enabled: newEnabled });
      setConfig(saved);
      setEnabled(saved.enabled);
      setNotice(t('settings.feishu.notice.channelUpdated', {
        status: newEnabled
          ? t('settings.feishu.status.enabled')
          : t('settings.feishu.status.disabled'),
        connectedSuffix: saved.connected ? t('settings.feishu.status.connectedSuffix') : '',
      }));

    } catch (err) {
      setError(getErrorMessage(err, t('settings.feishu.errors.toggleFailed')));
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = { appId, enabled };
      if (appSecret.trim()) payload.appSecret = appSecret;
      if (!appSecret.trim() && clearSecret) payload.clearAppSecret = true;

      const saved = await api.put<FeishuConfigPublic>('/api/config/feishu', payload);
      setConfig(saved);
      setAppSecret('');
      setClearSecret(false);
      setNotice(t('settings.feishu.notice.saved', {
        connectedSuffix: saved.connected ? t('settings.feishu.status.connectedSuffix') : '',
      }));

    } catch (err) {
      setError(getErrorMessage(err, t('settings.feishu.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const formDisabled = !enabled;
  const busy = loading || saving || toggling;

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${config?.connected ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('settings.feishu.title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.feishu.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            config?.connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-border/70 bg-card/75 text-muted-foreground'
          }`}>
            {config?.connected ? t('settings.feishu.connected') : t('settings.feishu.notConnected')}
          </span>
          <SettingsSwitch
            checked={enabled}
            disabled={busy}
            onCheckedChange={handleToggle}
            ariaLabel={t('settings.feishu.toggleAria')}
          />
        </div>
      </div>

      <div className={`px-5 py-4 space-y-4 transition-opacity ${formDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted/10 p-3">
            <label className="mb-1 block text-xs font-medium text-foreground/80">{t('settings.feishu.appId')}</label>
            <Input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              disabled={loading || saving}
              placeholder={t('settings.feishu.appIdPlaceholder')}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.feishu.appIdHint')}</p>
          </div>

          <div className="rounded-lg bg-muted/10 p-3">
            <label className="mb-1 block text-xs font-medium text-foreground/80">
              {t('settings.feishu.appSecret')} {config?.hasAppSecret ? `(${config.appSecretMasked})` : ''}
            </label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              disabled={loading || saving}
              placeholder={
                config?.hasAppSecret
                  ? t('settings.feishu.appSecretPlaceholderOverride')
                  : t('settings.feishu.appSecretPlaceholder')
              }
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('settings.feishu.appSecretHint')}
            </p>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={clearSecret}
                onChange={(e) => setClearSecret(e.target.checked)}
                disabled={saving}
              />
              {t('settings.feishu.clearSecret')}
            </label>
          </div>
        </div>

        <SettingsActionBar>
          <Button variant="outline" onClick={loadConfig} disabled={busy} className="h-10 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? t('settings.feishu.refreshing') : t('settings.feishu.refresh')}
          </Button>
          <Button onClick={handleSave} disabled={busy} className="h-10 rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? t('settings.feishu.saving') : t('settings.feishu.save')}
          </Button>
        </SettingsActionBar>

        <SettingsMetaGrid
          items={[
            {
              label: t('settings.feishu.currentSource'),
              value:
                config?.source === 'runtime'
                  ? t('settings.feishu.source.runtime')
                  : config?.source === 'env'
                    ? t('settings.feishu.source.env')
                    : t('settings.feishu.source.none'),
            },
            {
              label: t('settings.feishu.lastSaved'),
              value: config?.updatedAt
                ? new Date(config.updatedAt).toLocaleString(localeForDateTime(locale))
                : t('settings.feishu.notRecorded'),
            },
          ]}
        />
      </div>
    </div>
  );
}
