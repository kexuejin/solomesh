import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Copy, Check, Link, RefreshCw, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';
import { localeForDateTime, useI18n } from '../../i18n';

interface UserFeishuConfig {
  appId: string;
  hasAppSecret: boolean;
  appSecretMasked: string | null;
}

interface UserTelegramConfig {
  hasBotToken: boolean;
  botTokenMasked: string | null;
}

interface PairingCodeResult {
  code: string;
  expiresAt: number;
  ttlSeconds: number;
}

interface PairedChat {
  jid: string;
  name: string;
  addedAt: string;
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch {
      reject(new Error('execCommand copy failed'));
    } finally {
      document.body.removeChild(ta);
    }
  });
}

interface UserChannelsSectionProps extends SettingsNotification {}

export function UserChannelsSection({ setNotice, setError }: UserChannelsSectionProps) {
  const { locale, t } = useI18n();

  const [feishuConfig, setFeishuConfig] = useState<UserFeishuConfig | null>(null);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuLoading, setFeishuLoading] = useState(true);
  const [feishuSaving, setFeishuSaving] = useState(false);

  const [telegramConfig, setTelegramConfig] = useState<UserTelegramConfig | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);

  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCountdown, setPairingCountdown] = useState(0);
  const [pairingGenerating, setPairingGenerating] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [pairedChats, setPairedChats] = useState<PairedChat[]>([]);
  const [pairedChatsLoading, setPairedChatsLoading] = useState(false);
  const [removingJid, setRemovingJid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFeishu = useCallback(async () => {
    setFeishuLoading(true);
    try {
      const data = await api.get<UserFeishuConfig>('/api/config/user-im/feishu');
      setFeishuConfig(data);
      setFeishuAppId(data.appId || '');
      setFeishuAppSecret('');
    } catch {
      setFeishuConfig(null);
    } finally {
      setFeishuLoading(false);
    }
  }, []);

  const loadTelegram = useCallback(async () => {
    setTelegramLoading(true);
    try {
      const data = await api.get<UserTelegramConfig>('/api/config/user-im/telegram');
      setTelegramConfig(data);
      setTelegramBotToken('');
    } catch {
      setTelegramConfig(null);
    } finally {
      setTelegramLoading(false);
    }
  }, []);

  const loadPairedChats = useCallback(async () => {
    setPairedChatsLoading(true);
    try {
      const data = await api.get<{ chats: PairedChat[] }>('/api/config/user-im/telegram/paired-chats');
      setPairedChats(data.chats);
    } catch {
      setPairedChats([]);
    } finally {
      setPairedChatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeishu();
    loadTelegram();
    loadPairedChats();
  }, [loadFeishu, loadTelegram, loadPairedChats]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const startCountdown = useCallback((expiresAt: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const update = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setPairingCountdown(remaining);
      if (remaining <= 0) {
        setPairingCode(null);
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    };
    update();
    countdownRef.current = setInterval(update, 1000);
  }, []);

  const handleGeneratePairingCode = async () => {
    setPairingGenerating(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api.post<PairingCodeResult>('/api/config/user-im/telegram/pairing-code');
      setPairingCode(result.code);
      startCountdown(Date.now() + result.ttlSeconds * 1000);
    } catch (err) {
      setError(getErrorMessage(err, t('settings.userChannels.telegram.pairing.errors.generateFailed')));
    } finally {
      setPairingGenerating(false);
    }
  };

  const handleCopyPairCommand = () => {
    if (!pairingCode) return;
    copyToClipboard(`/pair ${pairingCode}`)
      .then(() => {
        setCopied(true);
        if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        setError(t('settings.userChannels.telegram.pairing.errors.copyFailed'));
      });
  };

  const handleRemovePairedChat = async (jid: string) => {
    setRemovingJid(jid);
    setNotice(null);
    setError(null);
    try {
      await api.delete(`/api/config/user-im/telegram/paired-chats/${encodeURIComponent(jid)}`);
      setPairedChats((prev) => prev.filter((c) => c.jid !== jid));
      setNotice(t('settings.userChannels.telegram.pairing.notice.removed'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.userChannels.telegram.pairing.errors.removeFailed')));
    } finally {
      setRemovingJid(null);
    }
  };

  const handleSaveFeishu = async () => {
    setFeishuSaving(true);
    setError(null);
    setNotice(null);
    try {
      const appId = feishuAppId.trim();
      const appSecret = feishuAppSecret.trim();

      if (appId && !appSecret && !feishuConfig?.hasAppSecret) {
        setError(t('settings.userChannels.feishu.errors.firstSetupRequiresBoth'));
        setFeishuSaving(false);
        return;
      }

      if (!appId && !appSecret) {
        if (feishuConfig?.appId || feishuConfig?.hasAppSecret) {
          setNotice(t('settings.userChannels.feishu.notice.noChanges'));
        } else {
          setError(t('settings.userChannels.feishu.errors.fillBoth'));
        }
        setFeishuSaving(false);
        return;
      }

      const payload: Record<string, string | boolean> = { enabled: true };
      if (appId) payload.appId = appId;
      if (appSecret) payload.appSecret = appSecret;
      await api.put('/api/config/user-im/feishu', payload);
      setNotice(t('settings.userChannels.feishu.notice.saved'));
      await loadFeishu();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.userChannels.feishu.errors.saveFailed')));
    } finally {
      setFeishuSaving(false);
    }
  };

  const handleSaveTelegram = async () => {
    setTelegramSaving(true);
    setError(null);
    setNotice(null);
    try {
      const token = telegramBotToken.trim();
      if (!token) {
        if (telegramConfig?.hasBotToken) {
          setNotice(t('settings.userChannels.telegram.notice.noChanges'));
        } else {
          setError(t('settings.userChannels.telegram.errors.tokenRequired'));
        }
        setTelegramSaving(false);
        return;
      }

      await api.put('/api/config/user-im/telegram', {
        botToken: token,
        enabled: true,
      });
      setNotice(t('settings.userChannels.telegram.notice.saved'));
      await loadTelegram();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.userChannels.telegram.errors.saveFailed')));
    } finally {
      setTelegramSaving(false);
    }
  };

  const feishuReady = !!(feishuConfig?.appId && feishuConfig.hasAppSecret);
  const feishuBusy = feishuLoading || feishuSaving;
  const telegramReady = !!telegramConfig?.hasBotToken;
  const telegramBusy = telegramLoading || telegramSaving || pairingGenerating;
  const configuredText = t('settings.userChannels.configured');
  const notConfiguredText = t('settings.userChannels.notConfigured');

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        {t('settings.userChannels.description')}
      </div>

      <div className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${feishuReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('settings.userChannels.feishu.title')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.userChannels.feishu.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {feishuBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              feishuReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {feishuReady ? configuredText : notConfiguredText}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {feishuLoading ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('settings.userChannels.loading')}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">{t('settings.userChannels.feishu.appIdLabel')}</label>
                  <Input
                    type="text"
                    value={feishuAppId}
                    onChange={(e) => setFeishuAppId(e.target.value)}
                    disabled={feishuBusy}
                    placeholder={t('settings.userChannels.feishu.appIdPlaceholder')}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">{t('settings.userChannels.feishu.appSecretLabel')}</label>
                  <Input
                    type="password"
                    value={feishuAppSecret}
                    onChange={(e) => setFeishuAppSecret(e.target.value)}
                    disabled={feishuBusy}
                    placeholder={feishuConfig?.hasAppSecret
                      ? t('settings.userChannels.feishu.appSecretPlaceholderKeep')
                      : t('settings.userChannels.feishu.appSecretPlaceholder')}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">{t('settings.userChannels.feishu.appSecretHint')}</p>
                </div>
              </div>

              <SettingsActionBar>
                <Button variant="outline" onClick={loadFeishu} disabled={feishuBusy} className="h-10 rounded-xl">
                  <RefreshCw className={`size-4 ${feishuLoading ? 'animate-spin' : ''}`} />
                  {feishuLoading ? t('settings.userChannels.refreshing') : t('settings.userChannels.refresh')}
                </Button>
                <Button onClick={handleSaveFeishu} disabled={feishuBusy} className="h-10 rounded-xl">
                  {feishuSaving && <Loader2 className="size-4 animate-spin" />}
                  {feishuSaving ? t('settings.userChannels.saving') : t('settings.userChannels.feishu.save')}
                </Button>
              </SettingsActionBar>

              <SettingsMetaGrid
                items={[
                  { label: t('settings.userChannels.feishu.currentAppId'), value: feishuConfig?.appId || notConfiguredText },
                  { label: t('settings.userChannels.feishu.currentSecret'), value: feishuConfig?.appSecretMasked || notConfiguredText },
                ]}
              />
            </>
          )}
        </div>
      </div>

      <div className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${telegramReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('settings.userChannels.telegram.title')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.userChannels.telegram.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {telegramBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              telegramReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {telegramReady ? configuredText : notConfiguredText}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {telegramLoading ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('settings.userChannels.loading')}
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="mb-1 block text-xs font-medium text-foreground/80">{t('settings.userChannels.telegram.botTokenLabel')}</label>
                <Input
                  type="password"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  disabled={telegramBusy}
                  placeholder={telegramConfig?.hasBotToken
                    ? t('settings.userChannels.telegram.botTokenPlaceholderKeep')
                    : t('settings.userChannels.telegram.botTokenPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.userChannels.telegram.botTokenHint')}</p>
              </div>

              <SettingsActionBar>
                <Button variant="outline" onClick={loadTelegram} disabled={telegramBusy} className="h-10 rounded-xl">
                  <RefreshCw className={`size-4 ${telegramLoading ? 'animate-spin' : ''}`} />
                  {telegramLoading ? t('settings.userChannels.refreshing') : t('settings.userChannels.refresh')}
                </Button>
                <Button onClick={handleSaveTelegram} disabled={telegramBusy} className="h-10 rounded-xl">
                  {telegramSaving && <Loader2 className="size-4 animate-spin" />}
                  {telegramSaving ? t('settings.userChannels.saving') : t('settings.userChannels.telegram.save')}
                </Button>
              </SettingsActionBar>

              <SettingsMetaGrid
                columns={1}
                className="max-w-md"
                items={[{ label: t('settings.userChannels.telegram.currentToken'), value: telegramConfig?.botTokenMasked || notConfiguredText }]}
              />

              {telegramReady && (
                <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
                  <div className="flex items-center gap-2">
                    <Link className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium text-foreground">{t('settings.userChannels.telegram.pairing.title')}</h4>
                  </div>

                  {pairingCode && pairingCountdown > 0 ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <code className="select-all rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 font-mono text-2xl font-bold tracking-widest text-brand-700">
                          {pairingCode}
                        </code>
                        <div className="text-sm text-muted-foreground">
                          {t('settings.userChannels.telegram.pairing.expiresIn', {
                            time: `${Math.floor(pairingCountdown / 60)}:${String(pairingCountdown % 60).padStart(2, '0')}`,
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleCopyPairCommand} className="rounded-lg">
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? t('settings.userChannels.telegram.pairing.copied') : t('settings.userChannels.telegram.pairing.copyCommand')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleGeneratePairingCode} disabled={pairingGenerating} className="rounded-lg">
                          {pairingGenerating && <Loader2 className="size-3.5 animate-spin" />}
                          {pairingGenerating
                            ? t('settings.userChannels.telegram.pairing.generating')
                            : t('settings.userChannels.telegram.pairing.regenerate')}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.userChannels.telegram.pairing.sendHintPrefix')}{' '}
                        <code className="rounded bg-muted px-1">/pair {pairingCode}</code>{' '}
                        {t('settings.userChannels.telegram.pairing.sendHintSuffix')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button variant="outline" onClick={handleGeneratePairingCode} disabled={pairingGenerating} className="h-10 rounded-xl">
                        {pairingGenerating && <Loader2 className="size-4 animate-spin" />}
                        {pairingGenerating
                          ? t('settings.userChannels.telegram.pairing.generating')
                          : t('settings.userChannels.telegram.pairing.generateCode')}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {t('settings.userChannels.telegram.pairing.generateHintPrefix')}{' '}
                        <code className="rounded bg-muted px-1">/pair &lt;code&gt;</code>{' '}
                        {t('settings.userChannels.telegram.pairing.generateHintSuffix')}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-medium text-muted-foreground">{t('settings.userChannels.telegram.pairing.pairedChatsTitle')}</h5>
                      <Button variant="outline" size="sm" onClick={loadPairedChats} disabled={pairedChatsLoading} className="rounded-lg">
                        <RefreshCw className={`size-3.5 ${pairedChatsLoading ? 'animate-spin' : ''}`} />
                        {pairedChatsLoading ? t('settings.userChannels.refreshing') : t('settings.userChannels.refresh')}
                      </Button>
                    </div>

                    {pairedChatsLoading ? (
                      <div className="surface-card-soft border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {t('settings.userChannels.loading')}
                      </div>
                    ) : pairedChats.length === 0 ? (
                      <div className="surface-card-soft rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {t('settings.userChannels.telegram.pairing.emptyChats')}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {pairedChats.map((chat) => (
                          <div key={chat.jid} className="group flex items-center justify-between rounded-xl border border-border/70 bg-card px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm text-foreground">{chat.name}</div>
                              <div className="text-xs text-muted-foreground">{new Date(chat.addedAt).toLocaleString(localeForDateTime(locale))}</div>
                            </div>
                            <button
                              onClick={() => handleRemovePairedChat(chat.jid)}
                              disabled={removingJid === chat.jid}
                              className="ml-2 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-red-500 disabled:opacity-50"
                              title={t('settings.userChannels.telegram.pairing.removeTitle')}
                            >
                              {removingJid === chat.jid ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
