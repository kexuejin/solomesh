import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import { localeForDateTime, useI18n } from '../../i18n';
import { SettingsActionBar } from './SettingsActionBar';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type { SettingsNotification } from './types';
import { getErrorMessage } from './types';

type TunnelProviderKind = 'cloudflared' | 'ngrok' | 'tunwg' | 'custom';
type TunnelStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'error';

interface TunnelStatusSnapshot {
  status: TunnelStatus;
  provider?: TunnelProviderKind;
  targetUrl?: string;
  publicUrl?: string;
  startedAt?: string;
  updatedAt: string;
  restartCount: number;
  lastError?: string;
}

type AccessLinkMode = 'token' | 'public';

interface RemoteAccessLinkPreferences {
  mode: AccessLinkMode;
  ttlSeconds: number;
  oneTime: boolean;
}

interface RemoteAccessStatusResponse {
  enabled: boolean;
  defaultTargetUrl: string;
  tunnel: TunnelStatusSnapshot;
  preferences: RemoteAccessLinkPreferences;
  providers: Array<{
    kind: 'cloudflared' | 'ngrok';
    executable: string;
    available: boolean;
  }>;
}

interface RemoteAccessStartStopResponse {
  success: boolean;
  tunnel: TunnelStatusSnapshot;
}

interface RemoteAccessLinkResult {
  mode: AccessLinkMode;
  code: string;
  token?: string;
  expiresAt?: string;
  url: string;
}

interface RemoteAccessLinkResponse {
  success: boolean;
  link: RemoteAccessLinkResult;
}

interface RemoteAccessPreferencesResponse {
  success: boolean;
  preferences: RemoteAccessLinkPreferences;
}

type AccessTokenVerifyResult =
  | {
    valid: true;
    payload: {
      v: 1;
      iat: number;
      exp: number;
      jti: string;
      oneTime: boolean;
    };
  }
  | {
    valid: false;
    reason: string;
  };

interface RemoteAccessTokenVerifyResponse {
  success: boolean;
  result: AccessTokenVerifyResult;
}

interface RemoteAccessTokenRevokeResponse {
  success: boolean;
  revoked: boolean;
}

type AccessTokenStatus = 'active' | 'expired' | 'revoked' | 'consumed';

interface AccessTokenListItem {
  tokenId: string;
  issuedAt: string;
  expiresAt: string;
  oneTime: boolean;
  status: AccessTokenStatus;
}

interface RemoteAccessTokenListResponse {
  success: boolean;
  tokens: AccessTokenListItem[];
}

interface RemoteAccessSectionProps extends SettingsNotification {}

const DEFAULT_LINK_PREFERENCES: RemoteAccessLinkPreferences = {
  mode: 'token',
  ttlSeconds: 1800,
  oneTime: false,
};

function formatDateTime(value: string | undefined, locale: 'zh-CN' | 'en'): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(localeForDateTime(locale));
}

export function RemoteAccessSection({ setNotice, setError }: RemoteAccessSectionProps) {
  const { locale, t } = useI18n();
  const [status, setStatus] = useState<RemoteAccessStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [creatingLink, setCreatingLink] = useState(false);
  const [provider, setProvider] = useState<'cloudflared' | 'ngrok'>('cloudflared');
  const [providerLocked, setProviderLocked] = useState(false);
  const [targetUrl, setTargetUrl] = useState('');
  const [autoRestart, setAutoRestart] = useState(true);
  const [linkMode, setLinkMode] = useState<AccessLinkMode>(DEFAULT_LINK_PREFERENCES.mode);
  const [ttlSeconds, setTtlSeconds] = useState(String(DEFAULT_LINK_PREFERENCES.ttlSeconds));
  const [path, setPath] = useState('/app');
  const [oneTime, setOneTime] = useState(DEFAULT_LINK_PREFERENCES.oneTime);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [latestLink, setLatestLink] = useState<RemoteAccessLinkResult | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [consumeOneTimeOnVerify, setConsumeOneTimeOnVerify] = useState(false);
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [revokingToken, setRevokingToken] = useState(false);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<AccessTokenVerifyResult | null>(null);
  const [tokenHistory, setTokenHistory] = useState<AccessTokenListItem[]>([]);
  const [loadingTokenHistory, setLoadingTokenHistory] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<RemoteAccessStatusResponse>('/api/remote-access/status');
      setStatus(data);
      setTargetUrl((current) => current || data.defaultTargetUrl);
      const preferences = data.preferences ?? DEFAULT_LINK_PREFERENCES;
      setLinkMode(preferences.mode);
      setTtlSeconds(String(preferences.ttlSeconds));
      setOneTime(preferences.oneTime);
    } catch (err) {
      const statusCode = (err as { status?: number })?.status;
      if (statusCode === 503) {
        setStatus(null);
        return;
      }
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [setError, t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const loadTokenHistory = useCallback(async () => {
    setLoadingTokenHistory(true);
    try {
      const data = await api.get<RemoteAccessTokenListResponse>('/api/remote-access/tokens');
      setTokenHistory(data.tokens);
    } catch (err) {
      const statusCode = (err as { status?: number })?.status;
      if (statusCode === 503) {
        setTokenHistory([]);
        return;
      }
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.listTokensFailed')));
    } finally {
      setLoadingTokenHistory(false);
    }
  }, [setError, t]);

  useEffect(() => {
    void loadTokenHistory();
  }, [loadTokenHistory]);

  useEffect(() => {
    if (!copyDone) return;
    const timer = window.setTimeout(() => setCopyDone(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copyDone]);

  const tunnel = status?.tunnel;
  const isRunning = tunnel?.status === 'running';
  const providerAvailability = useMemo(
    () => new Map((status?.providers ?? []).map((item) => [item.kind, item])),
    [status?.providers],
  );
  useEffect(() => {
    if (!status || providerLocked) {
      return;
    }
    if (status.tunnel.provider === 'cloudflared' || status.tunnel.provider === 'ngrok') {
      setProvider(status.tunnel.provider);
      return;
    }

    const availableNgrok = providerAvailability.get('ngrok')?.available === true;
    const availableCloudflared = providerAvailability.get('cloudflared')?.available === true;
    if (availableNgrok) {
      setProvider('ngrok');
      return;
    }
    if (availableCloudflared) {
      setProvider('cloudflared');
    }
  }, [status, providerAvailability, providerLocked]);

  const selectedProviderAvailable =
    providerAvailability.get(provider)?.available ?? true;
  const statusText = useMemo(() => {
    switch (tunnel?.status) {
      case 'starting':
        return t('settings.remoteAccess.status.starting');
      case 'running':
        return t('settings.remoteAccess.status.running');
      case 'stopped':
        return t('settings.remoteAccess.status.stopped');
      case 'error':
        return t('settings.remoteAccess.status.error');
      default:
        return t('settings.remoteAccess.status.idle');
    }
  }, [t, tunnel?.status]);

  const handleStart = async () => {
    const resolvedTargetUrl = targetUrl.trim() || status?.defaultTargetUrl || '';
    if (!resolvedTargetUrl) {
      setError(t('settings.remoteAccess.errors.targetUrlRequired'));
      return;
    }
    if (!selectedProviderAvailable) {
      const command = providerAvailability.get(provider)?.executable || provider;
      setError(t('settings.remoteAccess.errors.providerUnavailable', { provider, command }));
      return;
    }

    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<RemoteAccessStartStopResponse>('/api/remote-access/tunnel/start', {
        provider,
        targetUrl: resolvedTargetUrl,
        autoRestart,
      });
      setStatus((current) =>
        current
          ? { ...current, tunnel: data.tunnel }
          : {
              enabled: true,
              defaultTargetUrl: resolvedTargetUrl,
              tunnel: data.tunnel,
              preferences: status?.preferences ?? {
                mode: linkMode,
                ttlSeconds: Number.isFinite(Number(ttlSeconds))
                  ? Math.max(1, Math.floor(Number(ttlSeconds)))
                  : DEFAULT_LINK_PREFERENCES.ttlSeconds,
                oneTime,
              },
              providers: status?.providers ?? [],
            },
      );
      setNotice(t('settings.remoteAccess.notice.tunnelStarted'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.startFailed')));
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<RemoteAccessStartStopResponse>('/api/remote-access/tunnel/stop', {});
      setStatus((current) =>
        current
          ? { ...current, tunnel: data.tunnel }
          : null,
      );
      setNotice(t('settings.remoteAccess.notice.tunnelStopped'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.stopFailed')));
    } finally {
      setStopping(false);
    }
  };

  const handleCreateLink = async () => {
    const ttl = Number(ttlSeconds);
    if (linkMode === 'token' && (!Number.isFinite(ttl) || ttl <= 0)) {
      setError(t('settings.remoteAccess.errors.invalidTtl'));
      return;
    }
    const redirectPath = path.trim()
      ? (path.trim().startsWith('/') ? path.trim() : `/${path.trim()}`)
      : '/';

    setCreatingLink(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        mode: linkMode,
        path: redirectPath,
      };
      if (linkMode === 'token') {
        payload.ttlSeconds = Math.floor(ttl);
        payload.oneTime = oneTime;
      }
      const data = await api.post<RemoteAccessLinkResponse>('/api/remote-access/links', {
        ...payload,
      });
      setLatestLink(data.link);
      setTokenInput(data.link.token ?? '');
      setVerifyResult(null);
      setNotice(t('settings.remoteAccess.notice.linkCreated'));
      void loadTokenHistory();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.createLinkFailed')));
    } finally {
      setCreatingLink(false);
    }
  };

  const handleSaveLinkDefaults = async () => {
    const ttl = Number(ttlSeconds);
    if (linkMode === 'token' && (!Number.isFinite(ttl) || ttl <= 0)) {
      setError(t('settings.remoteAccess.errors.invalidTtl'));
      return;
    }

    setSavingDefaults(true);
    setError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        mode: linkMode,
        oneTime,
      };
      if (linkMode === 'token') {
        payload.ttlSeconds = Math.floor(ttl);
      }
      const data = await api.put<RemoteAccessPreferencesResponse>(
        '/api/remote-access/preferences',
        payload,
      );
      setStatus((current) => current
        ? { ...current, preferences: data.preferences }
        : current);
      setLinkMode(data.preferences.mode);
      setTtlSeconds(String(data.preferences.ttlSeconds));
      setOneTime(data.preferences.oneTime);
      setNotice(t('settings.remoteAccess.notice.defaultsSaved'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.saveDefaultsFailed')));
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleCopyLink = async () => {
    if (!latestLink?.url) return;
    try {
      await navigator.clipboard.writeText(latestLink.url);
      setCopyDone(true);
      setNotice(t('settings.remoteAccess.notice.linkCopied'));
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.copyLinkFailed')));
    }
  };

  const reasonLabel = (reason: string): string => {
    switch (reason) {
      case 'malformed':
        return t('settings.remoteAccess.verifyReasons.malformed');
      case 'invalid_signature':
        return t('settings.remoteAccess.verifyReasons.invalidSignature');
      case 'expired':
        return t('settings.remoteAccess.verifyReasons.expired');
      case 'revoked':
        return t('settings.remoteAccess.verifyReasons.revoked');
      case 'consumed':
        return t('settings.remoteAccess.verifyReasons.consumed');
      default:
        return reason;
    }
  };

  const tokenStatusLabel = (tokenStatus: AccessTokenStatus): string => {
    switch (tokenStatus) {
      case 'active':
        return t('settings.remoteAccess.tokenStatus.active');
      case 'expired':
        return t('settings.remoteAccess.tokenStatus.expired');
      case 'revoked':
        return t('settings.remoteAccess.tokenStatus.revoked');
      case 'consumed':
        return t('settings.remoteAccess.tokenStatus.consumed');
      default:
        return tokenStatus;
    }
  };

  const handleVerifyToken = async () => {
    const token = tokenInput.trim();
    if (!token) {
      setError(t('settings.remoteAccess.errors.tokenRequired'));
      return;
    }

    setVerifyingToken(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<RemoteAccessTokenVerifyResponse>(
        '/api/remote-access/tokens/verify',
        {
          token,
          consumeOneTime: consumeOneTimeOnVerify,
        },
      );
      setVerifyResult(data.result);
      setNotice(t('settings.remoteAccess.notice.tokenVerified'));
      if (consumeOneTimeOnVerify && data.result.valid && data.result.payload.oneTime) {
        void loadTokenHistory();
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.verifyFailed')));
    } finally {
      setVerifyingToken(false);
    }
  };

  const handleRevokeToken = async () => {
    const token = tokenInput.trim();
    if (!token) {
      setError(t('settings.remoteAccess.errors.tokenRequired'));
      return;
    }

    setRevokingToken(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<RemoteAccessTokenRevokeResponse>(
        '/api/remote-access/tokens/revoke',
        {
          token,
        },
      );
      setNotice(
        data.revoked
          ? t('settings.remoteAccess.notice.tokenRevoked')
          : t('settings.remoteAccess.notice.tokenNotRevoked'),
      );
      if (data.revoked) {
        void loadTokenHistory();
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.revokeFailed')));
    } finally {
      setRevokingToken(false);
    }
  };

  const handleRevokeTokenById = async (tokenId: string) => {
    if (!tokenId.trim()) {
      return;
    }
    setRevokingTokenId(tokenId);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<RemoteAccessTokenRevokeResponse>(
        '/api/remote-access/tokens/revoke-by-id',
        { tokenId },
      );
      setNotice(
        data.revoked
          ? t('settings.remoteAccess.notice.tokenRevoked')
          : t('settings.remoteAccess.notice.tokenNotRevoked'),
      );
      if (data.revoked) {
        void loadTokenHistory();
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.remoteAccess.errors.revokeFailed')));
    } finally {
      setRevokingTokenId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
        {t('settings.remoteAccess.disabled')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85 space-y-1.5">
        <p>{t('settings.remoteAccess.description')}</p>
        <p>{t('settings.remoteAccess.securityHint')}</p>
      </div>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
              {t('settings.remoteAccess.statusBadge')}
            </div>
            <div className="mt-1 text-sm font-medium text-foreground">{t('settings.remoteAccess.statusTitle')}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadStatus()} className="rounded-xl">
            <RefreshCw className="size-4" />
            {t('settings.remoteAccess.refresh')}
          </Button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <SettingsMetaGrid
            items={[
              { label: t('settings.remoteAccess.fields.status'), value: statusText },
              { label: t('settings.remoteAccess.fields.provider'), value: tunnel?.provider || '-' },
              { label: t('settings.remoteAccess.fields.targetUrl'), value: tunnel?.targetUrl || status.defaultTargetUrl },
              { label: t('settings.remoteAccess.fields.publicUrl'), value: tunnel?.publicUrl || '-' },
              { label: t('settings.remoteAccess.fields.startedAt'), value: formatDateTime(tunnel?.startedAt, locale) },
              { label: t('settings.remoteAccess.fields.updatedAt'), value: formatDateTime(tunnel?.updatedAt, locale) },
              { label: t('settings.remoteAccess.fields.restartCount'), value: String(tunnel?.restartCount ?? 0) },
            ]}
            columns={2}
          />
          {!!tunnel?.lastError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('settings.remoteAccess.lastError', { error: tunnel.lastError })}
            </div>
          )}
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('settings.remoteAccess.tunnelBadge')}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.remoteAccess.tunnelTitle')}</div>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="space-y-1">
            {status.providers.map((item) => (
              <div
                key={item.kind}
                className={`text-xs ${
                  item.available ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {item.available
                  ? t('settings.remoteAccess.providerAvailable', {
                      provider: item.kind,
                      command: item.executable,
                    })
                  : t('settings.remoteAccess.providerUnavailable', {
                      provider: item.kind,
                      command: item.executable,
                    })}
              </div>
            ))}
          </div>
          <div className="inline-flex rounded-xl border border-border/70 bg-muted/20 p-1">
            <button
              type="button"
              onClick={() => {
                setProvider('cloudflared');
                setProviderLocked(true);
              }}
              disabled={!providerAvailability.get('cloudflared')?.available}
              className={`h-9 rounded-lg px-3 text-sm transition-colors ${
                provider === 'cloudflared'
                  ? 'bg-card text-brand-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              cloudflared
            </button>
            <button
              type="button"
              onClick={() => {
                setProvider('ngrok');
                setProviderLocked(true);
              }}
              disabled={!providerAvailability.get('ngrok')?.available}
              className={`h-9 rounded-lg px-3 text-sm transition-colors ${
                provider === 'ngrok'
                  ? 'bg-card text-brand-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ngrok
            </button>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground/80">{t('settings.remoteAccess.targetUrlLabel')}</label>
            <Input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={status.defaultTargetUrl}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/85">
            <input
              type="checkbox"
              checked={autoRestart}
              onChange={(e) => setAutoRestart(e.target.checked)}
              className="h-4 w-4"
            />
            {t('settings.remoteAccess.autoRestartLabel')}
          </label>
          <SettingsActionBar separated={false}>
            <Button onClick={handleStart} disabled={starting || !selectedProviderAvailable} className="h-10 rounded-xl">
              {starting ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {starting ? t('settings.remoteAccess.starting') : t('settings.remoteAccess.startTunnel')}
            </Button>
            <Button variant="outline" onClick={handleStop} disabled={stopping || !isRunning} className="h-10 rounded-xl">
              {stopping && <Loader2 className="size-4 animate-spin" />}
              {stopping ? t('settings.remoteAccess.stopping') : t('settings.remoteAccess.stopTunnel')}
            </Button>
          </SettingsActionBar>
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('settings.remoteAccess.linkBadge')}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">{t('settings.remoteAccess.linkTitle')}</div>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground/80">
              {t('settings.remoteAccess.linkModeLabel')}
            </label>
            <div className="inline-flex rounded-xl border border-border/70 bg-muted/20 p-1">
              <button
                type="button"
                onClick={() => setLinkMode('token')}
                className={`h-9 rounded-lg px-3 text-sm transition-colors ${
                  linkMode === 'token'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('settings.remoteAccess.linkModes.token')}
              </button>
              <button
                type="button"
                onClick={() => setLinkMode('public')}
                className={`h-9 rounded-lg px-3 text-sm transition-colors ${
                  linkMode === 'public'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('settings.remoteAccess.linkModes.public')}
              </button>
            </div>
          </div>
          <div className={`grid gap-3 ${linkMode === 'token' ? 'md:grid-cols-2' : ''}`}>
            {linkMode === 'token' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground/80">{t('settings.remoteAccess.ttlLabel')}</label>
                <Input
                  value={ttlSeconds}
                  onChange={(e) => setTtlSeconds(e.target.value)}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/80">{t('settings.remoteAccess.pathLabel')}</label>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="h-10 rounded-xl border-border/75 bg-card/95"
              />
            </div>
          </div>
          {linkMode === 'token' && (
            <label className="flex items-center gap-2 text-sm text-foreground/85">
              <input
                type="checkbox"
                checked={oneTime}
                onChange={(e) => setOneTime(e.target.checked)}
                className="h-4 w-4"
              />
              {t('settings.remoteAccess.oneTimeLabel')}
            </label>
          )}
          <SettingsActionBar separated={false}>
            <Button onClick={handleCreateLink} disabled={creatingLink || !isRunning} className="h-10 rounded-xl">
              {creatingLink ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
              {creatingLink ? t('settings.remoteAccess.creatingLink') : t('settings.remoteAccess.createLink')}
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveLinkDefaults}
              disabled={savingDefaults}
              className="h-10 rounded-xl"
            >
              {savingDefaults && <Loader2 className="size-4 animate-spin" />}
              {savingDefaults
                ? t('settings.remoteAccess.savingDefaults')
                : t('settings.remoteAccess.saveDefaults')}
            </Button>
          </SettingsActionBar>

          {latestLink && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-2">
              <div className="text-xs text-muted-foreground">
                {latestLink.mode === 'token'
                  ? t('settings.remoteAccess.linkExpiresAt', {
                      value: formatDateTime(latestLink.expiresAt, locale),
                    })
                  : t('settings.remoteAccess.linkNeverExpires')}
              </div>
              <div className="text-xs text-muted-foreground break-all">
                {t('settings.remoteAccess.linkCode', { value: latestLink.code })}
              </div>
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  readOnly
                  value={latestLink.url}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleCopyLink} className="h-10 rounded-xl">
                    {copyDone ? <Check className="size-4" /> : <Copy className="size-4" />}
                    {copyDone ? t('settings.remoteAccess.copied') : t('settings.remoteAccess.copyLink')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.open(latestLink.url, '_blank', 'noopener,noreferrer')}
                    className="h-10 rounded-xl"
                  >
                    <ExternalLink className="size-4" />
                    {t('settings.remoteAccess.openLink')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-border/70 bg-muted/35 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">
            {t('settings.remoteAccess.tokenBadge')}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {t('settings.remoteAccess.tokenTitle')}
          </div>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground/80">{t('settings.remoteAccess.tokenLabel')}</label>
            <Input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t('settings.remoteAccess.tokenPlaceholder')}
              className="h-10 rounded-xl border-border/75 bg-card/95"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground/85">
            <input
              type="checkbox"
              checked={consumeOneTimeOnVerify}
              onChange={(e) => setConsumeOneTimeOnVerify(e.target.checked)}
              className="h-4 w-4"
            />
            {t('settings.remoteAccess.consumeOneTimeOnVerify')}
          </label>
          <SettingsActionBar separated={false}>
            <Button onClick={handleVerifyToken} disabled={verifyingToken} className="h-10 rounded-xl">
              {verifyingToken && <Loader2 className="size-4 animate-spin" />}
              {verifyingToken ? t('settings.remoteAccess.verifyingToken') : t('settings.remoteAccess.verifyToken')}
            </Button>
            <Button variant="outline" onClick={handleRevokeToken} disabled={revokingToken} className="h-10 rounded-xl">
              {revokingToken && <Loader2 className="size-4 animate-spin" />}
              {revokingToken ? t('settings.remoteAccess.revokingToken') : t('settings.remoteAccess.revokeToken')}
            </Button>
          </SettingsActionBar>

          {verifyResult && (
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs text-foreground/85">
              {verifyResult.valid
                ? t('settings.remoteAccess.verifyValid', {
                    tokenId: verifyResult.payload.jti,
                    expiresAt: formatDateTime(
                      new Date(verifyResult.payload.exp * 1000).toISOString(),
                      locale,
                    ),
                  })
                : t('settings.remoteAccess.verifyInvalid', {
                  reason: reasonLabel(verifyResult.reason),
                })}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-foreground/80">
                {t('settings.remoteAccess.tokenHistoryTitle')}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadTokenHistory()}
                className="h-8 rounded-lg"
              >
                {loadingTokenHistory ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {t('settings.remoteAccess.refresh')}
              </Button>
            </div>
            {tokenHistory.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {loadingTokenHistory
                  ? t('settings.remoteAccess.tokenHistoryLoading')
                  : t('settings.remoteAccess.tokenHistoryEmpty')}
              </div>
            ) : (
              <div className="rounded-xl border border-border/70 bg-muted/20 divide-y divide-border/60">
                {tokenHistory.slice(0, 20).map((item) => (
                  <div key={item.tokenId} className="space-y-1 px-3 py-2 text-xs">
                    <div className="font-mono text-foreground/90 break-all">{item.tokenId}</div>
                    <div className="grid gap-1 text-muted-foreground md:grid-cols-2">
                      <div>
                        {t('settings.remoteAccess.tokenIssuedAt')}: {formatDateTime(item.issuedAt, locale)}
                      </div>
                      <div>
                        {t('settings.remoteAccess.tokenExpiresAt')}: {formatDateTime(item.expiresAt, locale)}
                      </div>
                      <div>
                        {t('settings.remoteAccess.tokenOneTime')}:{' '}
                        {item.oneTime
                          ? t('settings.remoteAccess.tokenOneTimeYes')
                          : t('settings.remoteAccess.tokenOneTimeNo')}
                      </div>
                      <div>
                        {t('settings.remoteAccess.tokenStatusLabel')}: {tokenStatusLabel(item.status)}
                      </div>
                    </div>
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRevokeTokenById(item.tokenId)}
                        disabled={item.status === 'revoked' || revokingTokenId === item.tokenId}
                        className="h-8 rounded-lg"
                      >
                        {revokingTokenId === item.tokenId && <Loader2 className="size-4 animate-spin" />}
                        {revokingTokenId === item.tokenId
                          ? t('settings.remoteAccess.revokingToken')
                          : t('settings.remoteAccess.revokeTokenById')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
