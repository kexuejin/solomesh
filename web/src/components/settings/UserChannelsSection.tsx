import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Copy, Check, Link, RefreshCw, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';

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

/** Clipboard write with fallback for non-HTTPS contexts */
function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback: temporary textarea
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
  // Feishu state
  const [feishuConfig, setFeishuConfig] = useState<UserFeishuConfig | null>(null);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuLoading, setFeishuLoading] = useState(true);
  const [feishuSaving, setFeishuSaving] = useState(false);

  // Telegram state
  const [telegramConfig, setTelegramConfig] = useState<UserTelegramConfig | null>(null);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);

  // Pairing state
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCountdown, setPairingCountdown] = useState(0);
  const [pairingGenerating, setPairingGenerating] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Paired chats state
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
      // API may not exist yet; treat as unconfigured
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

  // Timer cleanup
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
      setError(getErrorMessage(err, '生成配对码失败'));
    } finally {
      setPairingGenerating(false);
    }
  };

  const handleCopyPairCommand = () => {
    if (!pairingCode) return;
    copyToClipboard(`/pair ${pairingCode}`).then(() => {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setError('复制失败，请手动复制');
    });
  };

  const handleRemovePairedChat = async (jid: string) => {
    setRemovingJid(jid);
    setNotice(null);
    setError(null);
    try {
      await api.delete(`/api/config/user-im/telegram/paired-chats/${encodeURIComponent(jid)}`);
      setPairedChats((prev) => prev.filter((c) => c.jid !== jid));
      setNotice('配对聊天已移除');
    } catch (err) {
      setError(getErrorMessage(err, '移除配对聊天失败'));
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

      // Validate: if App ID is provided, Secret must also be provided (for first-time setup)
      if (appId && !appSecret && !feishuConfig?.hasAppSecret) {
        setError('首次配置飞书需要同时提供 App ID 和 App Secret');
        setFeishuSaving(false);
        return;
      }

      // No-op when user leaves fields empty while existing config is present.
      if (!appId && !appSecret) {
        if (feishuConfig?.appId || feishuConfig?.hasAppSecret) {
          setNotice('飞书配置无变更');
        } else {
          setError('请填写飞书 App ID 和 App Secret');
        }
        setFeishuSaving(false);
        return;
      }

      const payload: Record<string, string | boolean> = { enabled: true };
      if (appId) payload.appId = appId;
      if (appSecret) payload.appSecret = appSecret;
      await api.put('/api/config/user-im/feishu', payload);
      setNotice('飞书配置已保存');
      await loadFeishu();
    } catch (err) {
      setError(getErrorMessage(err, '保存飞书配置失败'));
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
          setNotice('Telegram 配置无变更');
        } else {
          setError('请输入 Telegram Bot Token');
        }
        setTelegramSaving(false);
        return;
      }

      await api.put('/api/config/user-im/telegram', {
        botToken: token,
        enabled: true,
      });
      setNotice('Telegram 配置已保存');
      await loadTelegram();
    } catch (err) {
      setError(getErrorMessage(err, '保存 Telegram 配置失败'));
    } finally {
      setTelegramSaving(false);
    }
  };

  const feishuReady = !!(feishuConfig?.appId && feishuConfig.hasAppSecret);
  const feishuBusy = feishuLoading || feishuSaving;
  const telegramReady = !!telegramConfig?.hasBotToken;
  const telegramBusy = telegramLoading || telegramSaving || pairingGenerating;

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
        绑定你个人的飞书或 Telegram 账号，消息将发送到你的主工作区。
      </div>

      <div className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${feishuReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
            <div>
              <h3 className="text-sm font-semibold text-foreground">飞书</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">个人飞书账号绑定到主工作区</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {feishuBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              feishuReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {feishuReady ? '已配置' : '未配置'}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {feishuLoading ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载中...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">App ID</label>
                  <Input
                    type="text"
                    value={feishuAppId}
                    onChange={(e) => setFeishuAppId(e.target.value)}
                    disabled={feishuBusy}
                    placeholder="输入飞书 App ID"
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">App Secret</label>
                  <Input
                    type="password"
                    value={feishuAppSecret}
                    onChange={(e) => setFeishuAppSecret(e.target.value)}
                    disabled={feishuBusy}
                    placeholder={feishuConfig?.hasAppSecret ? '留空不修改' : '输入飞书 App Secret'}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">安全原因不会回显 Secret 明文</p>
                </div>
              </div>

              <SettingsActionBar>
                <Button variant="outline" onClick={loadFeishu} disabled={feishuBusy} className="h-10 rounded-xl">
                  <RefreshCw className={`size-4 ${feishuLoading ? 'animate-spin' : ''}`} />
                  {feishuLoading ? '刷新中...' : '刷新'}
                </Button>
                <Button onClick={handleSaveFeishu} disabled={feishuBusy} className="h-10 rounded-xl">
                  {feishuSaving && <Loader2 className="size-4 animate-spin" />}
                  {feishuSaving ? '保存中...' : '保存飞书配置'}
                </Button>
              </SettingsActionBar>

              <SettingsMetaGrid
                items={[
                  { label: '当前 App ID', value: feishuConfig?.appId || '未配置' },
                  { label: '当前 Secret', value: feishuConfig?.appSecretMasked || '未配置' },
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
              <h3 className="text-sm font-semibold text-foreground">Telegram</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">个人 Telegram Bot 绑定与聊天配对</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {telegramBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              telegramReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {telegramReady ? '已配置' : '未配置'}
            </span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {telegramLoading ? (
            <div className="flex items-center gap-2 rounded-lg bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载中...
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="mb-1 block text-xs font-medium text-foreground/80">Bot Token</label>
                <Input
                  type="password"
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                  disabled={telegramBusy}
                  placeholder={telegramConfig?.hasBotToken ? '留空不修改' : '输入 Telegram Bot Token'}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
                <p className="mt-1 text-xs text-muted-foreground">安全原因不会回显 Token 明文</p>
              </div>

              <SettingsActionBar>
                <Button variant="outline" onClick={loadTelegram} disabled={telegramBusy} className="h-10 rounded-xl">
                  <RefreshCw className={`size-4 ${telegramLoading ? 'animate-spin' : ''}`} />
                  {telegramLoading ? '刷新中...' : '刷新'}
                </Button>
                <Button onClick={handleSaveTelegram} disabled={telegramBusy} className="h-10 rounded-xl">
                  {telegramSaving && <Loader2 className="size-4 animate-spin" />}
                  {telegramSaving ? '保存中...' : '保存 Telegram 配置'}
                </Button>
              </SettingsActionBar>

              <SettingsMetaGrid
                columns={1}
                className="max-w-md"
                items={[{ label: '当前 Token', value: telegramConfig?.botTokenMasked || '未配置' }]}
              />

              {telegramReady && (
                <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
                  <div className="flex items-center gap-2">
                    <Link className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-medium text-foreground">聊天配对</h4>
                  </div>

                  {pairingCode && pairingCountdown > 0 ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <code className="select-all rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 font-mono text-2xl font-bold tracking-widest text-brand-700">
                          {pairingCode}
                        </code>
                        <div className="text-sm text-muted-foreground">
                          {Math.floor(pairingCountdown / 60)}:{String(pairingCountdown % 60).padStart(2, '0')} 后过期
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleCopyPairCommand} className="rounded-lg">
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? '已复制' : '复制配对命令'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleGeneratePairingCode} disabled={pairingGenerating} className="rounded-lg">
                          {pairingGenerating && <Loader2 className="size-3.5 animate-spin" />}
                          {pairingGenerating ? '生成中...' : '重新生成'}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        在 Telegram 中向 Bot 发送 <code className="rounded bg-muted px-1">/pair {pairingCode}</code> 完成配对
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Button variant="outline" onClick={handleGeneratePairingCode} disabled={pairingGenerating} className="h-10 rounded-xl">
                        {pairingGenerating && <Loader2 className="size-4 animate-spin" />}
                        {pairingGenerating ? '生成中...' : '生成配对码'}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        生成一次性配对码，在 Telegram 聊天中发送 <code className="rounded bg-muted px-1">/pair &lt;code&gt;</code> 将聊天绑定到此账号
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-medium text-muted-foreground">已配对的聊天</h5>
                      <Button variant="outline" size="sm" onClick={loadPairedChats} disabled={pairedChatsLoading} className="rounded-lg">
                        <RefreshCw className={`size-3.5 ${pairedChatsLoading ? 'animate-spin' : ''}`} />
                        {pairedChatsLoading ? '刷新中...' : '刷新'}
                      </Button>
                    </div>

                    {pairedChatsLoading ? (
                      <div className="surface-card-soft border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">加载中...</div>
                    ) : pairedChats.length === 0 ? (
                      <div className="surface-card-soft rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        暂无已配对的聊天
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {pairedChats.map((chat) => (
                          <div key={chat.jid} className="group flex items-center justify-between rounded-xl border border-border/70 bg-card px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm text-foreground">{chat.name}</div>
                              <div className="text-xs text-muted-foreground">{new Date(chat.addedAt).toLocaleString('zh-CN')}</div>
                            </div>
                            <button
                              onClick={() => handleRemovePairedChat(chat.jid)}
                              disabled={removingJid === chat.jid}
                              className="ml-2 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-red-500 disabled:opacity-50"
                              title="移除配对"
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
