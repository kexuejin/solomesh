import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, MessageSquare, SkipForward } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '../stores/auth';
import { api } from '../api/client';
import { getErrorMessage } from '../components/settings/types';

export function SetupChannelsPage() {
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
      setError('填写飞书 Secret 时，App ID 也必须填写');
      return;
    }
    if (feishuAppId.trim() && !feishuAppSecret.trim()) {
      setError('填写飞书 App ID 时，App Secret 也必须填写');
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
      setError(getErrorMessage(err, '保存消息通道配置失败'));
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
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Optional Step</p>
          <h1 className="mb-2 text-2xl font-bold text-foreground">配置消息通道（可选）</h1>
          <p className="text-sm text-muted-foreground">
            绑定飞书或 Telegram，即可通过 IM 与 AI 对话。跳过后也可在设置中随时配置。
          </p>
        </div>

        <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
          这里配置的是你账号的个人 IM 通道，不会覆盖系统级渠道配置。
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
                <h2 className="text-sm font-semibold text-foreground">飞书</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">个人飞书应用凭证</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              feishuDraftReady ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
            }`}>
              {feishuDraftReady ? '已填写' : '待填写'}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              填写你的飞书应用凭证，绑定后即可在飞书中与 AI 对话。
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-3">
                <label className="mb-1 block text-sm font-medium text-foreground/80">App ID</label>
                <Input
                  type="text"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                  placeholder="输入飞书 App ID"
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                  disabled={saving}
                />
              </div>
              <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-3">
                <label className="mb-1 block text-sm font-medium text-foreground/80">App Secret</label>
                <Input
                  type="password"
                  value={feishuAppSecret}
                  onChange={(e) => setFeishuAppSecret(e.target.value)}
                  placeholder="输入飞书 App Secret"
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
                <h2 className="text-sm font-semibold text-foreground">Telegram</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">个人 Telegram Bot 凭证</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
              telegramDraftReady ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
            }`}>
              {telegramDraftReady ? '已填写' : '待填写'}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">
              填写 Telegram Bot Token，绑定后即可在 Telegram 中与 AI 对话。
            </p>
            <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-3">
              <label className="mb-1 block text-sm font-medium text-foreground/80">Bot Token</label>
              <Input
                type="password"
                value={telegramBotToken}
                onChange={(e) => setTelegramBotToken(e.target.value)}
                placeholder="输入 Telegram Bot Token"
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
            跳过
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-10 rounded-xl">
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存并继续
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
