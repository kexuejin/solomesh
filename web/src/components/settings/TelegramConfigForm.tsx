import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { SettingsSwitch } from './SettingsSwitch';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { TelegramConfigPublic, TelegramTestResult, SettingsNotification } from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface TelegramConfigFormProps extends SettingsNotification {}

export function TelegramConfigForm({ setNotice, setError }: TelegramConfigFormProps) {
  const { locale, t } = useI18n();
  const [config, setConfig] = useState<TelegramConfigPublic | null>(null);
  const [botToken, setBotToken] = useState('');
  const [clearToken, setClearToken] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<TelegramConfigPublic>('/api/config/telegram');
      setConfig(data);
      setBotToken('');
      setClearToken(false);
      setEnabled(data.enabled);
    } catch (err) {
      setError(getErrorMessage(err, t('settings.telegram.errors.loadFailed')));
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
      const saved = await api.put<TelegramConfigPublic>('/api/config/telegram', { enabled: newEnabled });
      setConfig(saved);
      setEnabled(saved.enabled);
      setNotice(t('settings.telegram.notice.channelUpdated', {
        status: newEnabled ? t('settings.telegram.status.enabled') : t('settings.telegram.status.disabled'),
        connectedSuffix: saved.connected ? t('settings.telegram.status.connectedSuffix') : '',
      }));

    } catch (err) {
      setError(getErrorMessage(err, t('settings.telegram.errors.toggleFailed')));
    } finally {
      setToggling(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const payload: Record<string, unknown> = { enabled };
      if (botToken.trim()) payload.botToken = botToken;
      if (!botToken.trim() && clearToken) payload.clearBotToken = true;

      const saved = await api.put<TelegramConfigPublic>('/api/config/telegram', payload);
      setConfig(saved);
      setBotToken('');
      setClearToken(false);
      setNotice(t('settings.telegram.notice.saved', {
        connectedSuffix: saved.connected ? t('settings.telegram.status.connectedSuffix') : '',
      }));

    } catch (err) {
      setError(getErrorMessage(err, t('settings.telegram.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post<TelegramTestResult>('/api/config/telegram/test');
      if (result.success) {
        setNotice(t('settings.telegram.notice.testSuccess', {
          username: result.bot_username || '-',
          name: result.bot_name || '-',
        }));
      } else {
        setError(result.error || t('settings.telegram.errors.testFailed'));
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.telegram.errors.testConnectionFailed')));
    } finally {
      setTesting(false);
    }
  };

  const formDisabled = !enabled;
  const busy = loading || saving || testing || toggling;

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${config?.connected ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('settings.telegram.title')}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.telegram.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            config?.connected
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-border/70 bg-card/75 text-muted-foreground'
          }`}>
            {config?.connected ? t('settings.telegram.connected') : t('settings.telegram.notConnected')}
          </span>
          <SettingsSwitch
            checked={enabled}
            disabled={busy}
            onCheckedChange={handleToggle}
            ariaLabel={t('settings.telegram.toggleAria')}
          />
        </div>
      </div>

      <div className={`px-5 py-4 space-y-4 transition-opacity ${formDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="rounded-lg bg-muted/10 p-3">
          <label className="mb-1 block text-xs font-medium text-foreground/80">
            {t('settings.telegram.botToken')} {config?.hasBotToken ? `(${config.botTokenMasked})` : ''}
          </label>
          <Input
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            disabled={loading || saving}
            placeholder={config?.hasBotToken
              ? t('settings.telegram.botTokenPlaceholderOverride')
              : t('settings.telegram.botTokenPlaceholder')}
            className="h-10 rounded-xl border-border/75 bg-card/95"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {t('settings.telegram.botTokenHint')}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={clearToken}
              onChange={(e) => setClearToken(e.target.checked)}
              disabled={saving}
            />
            {t('settings.telegram.clearToken')}
          </label>
        </div>

        <SettingsActionBar>
          <Button variant="outline" onClick={loadConfig} disabled={busy} className="h-10 rounded-xl">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? t('settings.telegram.refreshing') : t('settings.telegram.refresh')}
          </Button>
          <Button onClick={handleSave} disabled={busy} className="h-10 rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? t('settings.telegram.saving') : t('settings.telegram.save')}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={busy || !config?.hasBotToken} className="h-10 rounded-xl">
            {testing && <Loader2 className="size-4 animate-spin" />}
            {testing ? t('settings.telegram.testing') : t('settings.telegram.test')}
          </Button>
        </SettingsActionBar>

        <SettingsMetaGrid
          items={[
            {
              label: t('settings.telegram.currentSource'),
              value:
                config?.source === 'runtime'
                  ? t('settings.telegram.source.runtime')
                  : config?.source === 'env'
                    ? t('settings.telegram.source.env')
                    : t('settings.telegram.source.none'),
            },
            {
              label: t('settings.telegram.lastSaved'),
              value: config?.updatedAt
                ? new Date(config.updatedAt).toLocaleString(localeForDateTime(locale))
                : t('settings.telegram.notRecorded'),
            },
          ]}
        />
      </div>
    </div>
  );
}
