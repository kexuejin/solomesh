import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, MessageSquare, SkipForward } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/client';
import { getErrorMessage } from '../components/settings/types';
import { useI18n } from '../i18n';

export function SetupChannelsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user, initialized } = useAuthStore();

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Feishu
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');

  // Telegram
  const [telegramBotToken, setTelegramBotToken] = useState('');

  const feishuDraftReady = !!(feishuAppId.trim() && feishuAppSecret.trim());
  const telegramDraftReady = !!telegramBotToken.trim();

  useEffect(() => {
    if (user === null && initialized === true) {
      navigate('/login', { replace: true });
    }
  }, [user, initialized, navigate]);

  const handleSkip = () => {
    navigate('/chat', { replace: true });
  };

  const handleSave = async () => {
    setError(null);

    const hasFeishu = feishuAppId.trim() || feishuAppSecret.trim();
    const hasTelegram = telegramBotToken.trim();

    if (!hasFeishu && !hasTelegram) {
      navigate('/chat', { replace: true });
      return;
    }

    if (feishuAppSecret.trim() && !feishuAppId.trim()) {
      setError(t('setupChannels.errors.feishuSecretNeedsAppId'));
      return;
    }
    if (feishuAppId.trim() && !feishuAppSecret.trim()) {
      setError(t('setupChannels.errors.feishuAppIdNeedsSecret'));
      return;
    }

    setSaving(true);
    try {
      if (hasFeishu) {
        const payload: Record<string, string | boolean> = { enabled: true };
        if (feishuAppId.trim()) payload.appId = feishuAppId.trim();
        if (feishuAppSecret.trim()) payload.appSecret = feishuAppSecret.trim();
        await api.put('/api/config/user-im/feishu', payload);
      }

      if (hasTelegram) {
        await api.put('/api/config/user-im/telegram', {
          botToken: telegramBotToken.trim(),
          enabled: true,
        });
      }

      navigate('/chat', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, t('setupChannels.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-brand-200 bg-brand-50/70">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">{t('setupChannels.optionalStep')}</p>
          <h1 className="mb-2 text-2xl font-bold text-foreground">{t('setupChannels.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('setupChannels.subtitle')}
          </p>
        </div>

        <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
          {t('setupChannels.accountHint')}
        </div>

        {error && (
          <div className="surface-card-soft rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Feishu */}
        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${feishuDraftReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t('setupChannels.feishu.title')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('setupChannels.feishu.subtitle')}</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              feishuDraftReady ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
            }`}>
              {feishuDraftReady ? t('setupChannels.common.ready') : t('setupChannels.common.pending')}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              {t('setupChannels.feishu.description')}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-3">
                <label className="mb-1 block text-sm font-medium text-foreground/80">{t('setupChannels.feishu.appId')}</label>
                <Input
                  type="text"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                  placeholder={t('setupChannels.feishu.appIdPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                  disabled={saving}
                />
              </div>
              <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-3">
                <label className="mb-1 block text-sm font-medium text-foreground/80">{t('setupChannels.feishu.appSecret')}</label>
                <Input
                  type="password"
                  value={feishuAppSecret}
                  onChange={(e) => setFeishuAppSecret(e.target.value)}
                  placeholder={t('setupChannels.feishu.appSecretPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                  disabled={saving}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Telegram */}
        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/40 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${telegramDraftReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t('setupChannels.telegram.title')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('setupChannels.telegram.subtitle')}</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              telegramDraftReady ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
            }`}>
              {telegramDraftReady ? t('setupChannels.common.ready') : t('setupChannels.common.pending')}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              {t('setupChannels.telegram.description')}
            </p>
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-3">
              <label className="mb-1 block text-sm font-medium text-foreground/80">{t('setupChannels.telegram.botToken')}</label>
              <Input
                type="password"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder={t('setupChannels.telegram.botTokenPlaceholder')}
                className="h-10 rounded-xl border-border/75 bg-card/95"
                disabled={saving}
              />
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="surface-card-soft flex flex-col justify-end gap-3 rounded-xl border border-border/70 p-3 sm:flex-row">
          <Button variant="outline" onClick={handleSkip} disabled={saving} className="h-10 rounded-xl">
            <SkipForward className="w-4 h-4" />
            {t('setupChannels.actions.skip')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-10 rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('setupChannels.actions.saveAndContinue')}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
