import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Plus, RefreshCw, Rocket, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { api } from '../../api/client';
import {
  DEFAULT_RUNTIME_DEFINITIONS,
  normalizeRuntimeDefinitions,
  type AgentRuntimeId,
  type RuntimeDefinition,
} from '../../runtime-definitions';
import { resolveRuntimeTabAfterConfigLoad } from './runtime-tab-selection';
import {
  getRuntimeApplyEndpoint,
  getRuntimeConfigEndpoint,
  getRuntimeCustomEnvEndpoint,
  getRuntimeSecretsEndpoint,
} from '../../api/runtime-endpoints';
import {
  buildCodexSecretsPayload,
  buildGeminiSecretsPayload,
  hasSecretPayloadChanges,
  buildOfficialOauthSecretsPayload,
  buildOfficialSetupTokenSecretsPayload,
  buildThirdPartySecretsPayload,
} from './provider-secrets-payloads';
import { SettingsMetaGrid } from './SettingsMetaGrid';
import type {
  RuntimeConfigPublic,
  RuntimeCustomEnvResp,
  RuntimeApplyResult,
  EnvRow,
  SettingsNotification,
} from './types';
import { getErrorMessage } from './types';
import { looksLikeHttpUrl } from '../../lib/runtime-input-validation';
import { localeForDateTime, useI18n } from '../../i18n';

type ClaudeAccessMode = 'official' | 'third_party';
type GeminiAccessMode = 'api_key' | 'oauth';
type EngineMode = AgentRuntimeId;

interface RuntimeSectionProps extends SettingsNotification {}

export function RuntimeSection({ setNotice, setError }: RuntimeSectionProps) {
  const { locale, t } = useI18n();
  const [config, setConfig] = useState<RuntimeConfigPublic | null>(null);
  const [engineMode, setEngineMode] = useState<EngineMode>('claude');
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDefinition[]>([]);
  const [claudeAccessMode, setClaudeAccessMode] = useState<ClaudeAccessMode>('third_party');

  const [officialCode, setOfficialCode] = useState('');

  // OAuth flow state
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState('');
  const [oauthExchanging, setOauthExchanging] = useState(false);
  const [geminiOauthLoading, setGeminiOauthLoading] = useState(false);
  const [geminiOauthState, setGeminiOauthState] = useState<string | null>(null);
  const [geminiOauthCode, setGeminiOauthCode] = useState('');
  const [geminiOauthExchanging, setGeminiOauthExchanging] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [customEnvRows, setCustomEnvRows] = useState<EnvRow[]>([]);

  const [codexApiKey, setCodexApiKey] = useState('');
  const [codexApiKeyDirty, setCodexApiKeyDirty] = useState(false);
  const [codexBaseUrl, setCodexBaseUrl] = useState('');
  const [codexModel, setCodexModel] = useState('');
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiApiKeyDirty, setGeminiApiKeyDirty] = useState(false);
  const [geminiModel, setGeminiModel] = useState('');
  const [geminiAccessMode, setGeminiAccessMode] = useState<GeminiAccessMode>('api_key');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadConfig = useCallback(async (options?: { preserveCurrentTab?: boolean }) => {
    const preserveCurrentTab = options?.preserveCurrentTab ?? true;
    setLoading(true);
    setError(null);
    try {
      const [configData, customEnvData, runtimesData] = await Promise.all([
        api.get<RuntimeConfigPublic>(getRuntimeConfigEndpoint()),
        api.get<RuntimeCustomEnvResp>(getRuntimeCustomEnvEndpoint()),
        api
          .get<{ runtimes: RuntimeDefinition[] }>('/api/config/runtimes')
          .catch(() => ({ runtimes: DEFAULT_RUNTIME_DEFINITIONS })),
      ]);

      const loadedRuntimes = Array.isArray(runtimesData.runtimes)
        ? normalizeRuntimeDefinitions(runtimesData.runtimes)
        : [];
      const runtimeOptions =
        loadedRuntimes.length > 0
          ? loadedRuntimes
          : DEFAULT_RUNTIME_DEFINITIONS;

      setRuntimeDefinitions(runtimeOptions);
      setConfig(configData);
      const runtimeIds = runtimeOptions.map((item) => item.id);
      setEngineMode((current) =>
        resolveRuntimeTabAfterConfigLoad({
          availableRuntimeIds: runtimeIds,
          savedRuntime: configData.agentRuntime,
          currentTab: current,
          preserveCurrentTab,
        }),
      );
      setBaseUrl(configData.anthropicBaseUrl || '');
      setCodexBaseUrl(configData.codexBaseUrl || '');
      setCodexModel(configData.codexModel || '');
      setGeminiBaseUrl(configData.geminiBaseUrl || '');
      setGeminiModel(configData.geminiModel || '');
      setGeminiAccessMode(configData.geminiAuthMode || 'api_key');
      setAuthToken('');
      setAuthTokenDirty(false);
      setCodexApiKey('');
      setCodexApiKeyDirty(false);
      setGeminiApiKey('');
      setGeminiApiKeyDirty(false);

      const envRows = Object.entries(customEnvData.customEnv || {}).map(([key, value]) => ({ key, value }));
      setCustomEnvRows(envRows);

      const inferredMode: ClaudeAccessMode =
        (configData.hasClaudeCodeOauthToken || configData.hasRuntimeOAuthCredentials) &&
        !configData.hasAnthropicAuthToken &&
        !configData.anthropicBaseUrl
          ? 'official'
          : 'third_party';
      setClaudeAccessMode(inferredMode);
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [setError, t]);

  useEffect(() => { void loadConfig({ preserveCurrentTab: false }); }, [loadConfig]);
  const runtimeOptions =
    runtimeDefinitions.length > 0
      ? runtimeDefinitions
      : DEFAULT_RUNTIME_DEFINITIONS;
  const currentRuntime = useMemo(
    () =>
      runtimeOptions.find((item) => item.id === engineMode) ??
      runtimeOptions[0] ??
      DEFAULT_RUNTIME_DEFINITIONS[0],
    [runtimeOptions, engineMode],
  );
  const supportsOAuthLogin = currentRuntime.capabilities.supportsOAuthLogin;
  const supportsOfficialAuth = currentRuntime.capabilities.supportsOfficialAuth;
  const supportsThirdPartyGateway =
    currentRuntime.capabilities.supportsThirdPartyGateway;
  const supportsModelOverride = currentRuntime.capabilities.supportsModelOverride;
  const effectiveClaudeAccessMode: ClaudeAccessMode =
    !supportsOfficialAuth && supportsThirdPartyGateway
      ? 'third_party'
      : !supportsThirdPartyGateway
        ? 'official'
        : claudeAccessMode;

  const updatedAt = useMemo(() => {
    if (!config?.updatedAt) return t('settings.runtime.notRecorded');
    return new Date(config.updatedAt).toLocaleString(localeForDateTime(locale));
  }, [config?.updatedAt, locale, t]);
  const savedRuntimeLabel = useMemo(() => {
    const savedId = config?.agentRuntime ?? engineMode;
    return runtimeOptions.find((item) => item.id === savedId)?.label ?? savedId;
  }, [config?.agentRuntime, engineMode, runtimeOptions]);
  const officialConfigured = !!(config?.hasClaudeCodeOauthToken || config?.hasRuntimeOAuthCredentials);
  const thirdPartyConfigured = !!(config?.hasAnthropicAuthToken || config?.anthropicBaseUrl);
  const codexConfigured = !!config?.hasCodexApiKey;
  const geminiConfigured = !!config?.hasGeminiApiKey;
  const geminiOAuthConfigured = !!config?.hasGeminiOAuthCredentials;
  const isGeminiRuntime = engineMode === 'gemini';
  const effectiveGeminiAccessMode: GeminiAccessMode = geminiAccessMode;
  const sdkKeySource =
    isGeminiRuntime
      ? (config?.geminiApiKeySource ?? 'none')
      : (config?.codexApiKeySource ?? 'none');
  const sdkKeyDegraded =
    isGeminiRuntime
      ? !!config?.geminiApiKeyDegraded
      : !!config?.codexApiKeyDegraded;
  const claudeOfficialDraftReady = officialConfigured || !!officialCode.trim();
  const claudeThirdPartyDraftReady = thirdPartyConfigured || (!!baseUrl.trim() && !!authToken.trim());
  const codexDraftReady = codexConfigured || !!codexApiKey.trim();
  const geminiDraftReady =
    effectiveGeminiAccessMode === 'oauth'
      ? geminiOAuthConfigured
      : geminiConfigured || !!geminiApiKey.trim();
  const sdkRuntimeDraftReady = isGeminiRuntime ? geminiDraftReady : codexDraftReady;
  const configuredText = t('settings.runtime.configured');
  const notConfiguredText = t('settings.runtime.notConfigured');
  const secretSourceLabel = (source: RuntimeConfigPublic['codexApiKeySource']) => {
    if (source === 'runtime') return t('settings.runtime.source.runtime');
    if (source === 'env') return t('settings.runtime.source.env');
    return t('settings.runtime.source.none');
  };
  useEffect(() => {
    if (!isGeminiRuntime || effectiveGeminiAccessMode !== 'oauth') {
      setGeminiOauthState(null);
      setGeminiOauthCode('');
    }
  }, [isGeminiRuntime, effectiveGeminiAccessMode]);

  const handleSaveDefaultRuntime = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const saved = await api.put<RuntimeConfigPublic>(getRuntimeConfigEndpoint(), {
        agentRuntime: engineMode,
      });
      setConfig(saved);
      setNotice(t('settings.runtime.notice.defaultRuntimeUpdated', { label: currentRuntime.label }));
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.saveDefaultRuntimeFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOfficial = async () => {
    if (!officialCode.trim()) {
      setError(t('settings.runtime.errors.officialCodeRequired'));
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await api.put<RuntimeConfigPublic>(getRuntimeConfigEndpoint(), {
        anthropicBaseUrl: '',
      });

      // Detect if user pasted .credentials.json content
      const trimmed = officialCode.trim();
      let isCredentialsJson = false;
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
          if (oauth?.accessToken && oauth?.refreshToken) {
            isCredentialsJson = true;
            const saved = await api.put<RuntimeConfigPublic>(
              getRuntimeSecretsEndpoint(),
              buildOfficialOauthSecretsPayload({
                accessToken: oauth.accessToken as string,
                refreshToken: oauth.refreshToken as string,
                expiresAt: oauth.expiresAt
                  ? new Date(oauth.expiresAt as string).getTime()
                  : Date.now() + 8 * 60 * 60 * 1000,
                scopes: Array.isArray(oauth.scopes)
                  ? (oauth.scopes as string[])
                  : [],
              }),
            );
            setConfig(saved);
            setOfficialCode('');
            setClaudeAccessMode('official');
            setNotice(t('settings.runtime.notice.claudeOauthSaved'));
            await loadConfig();
            return;
          }
        } catch {
          // Not valid JSON, treat as setup-token
        }
      }

      if (!isCredentialsJson) {
        const saved = await api.put<RuntimeConfigPublic>(
          getRuntimeSecretsEndpoint(),
          buildOfficialSetupTokenSecretsPayload(trimmed),
        );
        setConfig(saved);
        setOfficialCode('');
        setClaudeAccessMode('official');
        setNotice(t('settings.runtime.notice.claudeCredentialsSaved'));
        await loadConfig();
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.saveOfficialFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthStart = async () => {
    setOauthLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<{ authorizeUrl: string; state: string }>('/api/config/runtime/oauth/start');
      setOauthState(data.state);
      setOauthCode('');
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.oauthStartFailed')));
    } finally {
      setOauthLoading(false);
    }
  };

  const handleOAuthCallback = async () => {
    if (!oauthState || !oauthCode.trim()) {
      setError(t('settings.runtime.errors.oauthCodeRequired'));
      return;
    }
    setOauthExchanging(true);
    setError(null);
    setNotice(null);
    try {
      await api.post<RuntimeConfigPublic>('/api/config/runtime/oauth/callback', {
        state: oauthState,
        code: oauthCode.trim(),
      });
      setOauthState(null);
      setOauthCode('');
      setNotice(t('settings.runtime.notice.oauthLoginSuccess'));
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.oauthCallbackFailed')));
    } finally {
      setOauthExchanging(false);
    }
  };

  const handleGeminiOAuthStart = async () => {
    setGeminiOauthLoading(true);
    setError(null);
    setNotice(null);
    try {
      const data = await api.post<{ authorizeUrl: string; state: string }>(
        '/api/config/runtime/gemini/oauth/start',
      );
      setGeminiOauthState(data.state);
      setGeminiOauthCode('');
      window.open(data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.geminiOauthStartFailed')));
    } finally {
      setGeminiOauthLoading(false);
    }
  };

  const handleGeminiOAuthCallback = async () => {
    if (!geminiOauthState || !geminiOauthCode.trim()) {
      setError(t('settings.runtime.errors.geminiOauthCodeRequired'));
      return;
    }
    setGeminiOauthExchanging(true);
    setError(null);
    setNotice(null);
    try {
      await api.post<RuntimeConfigPublic>('/api/config/runtime/gemini/oauth/callback', {
        state: geminiOauthState,
        code: geminiOauthCode.trim(),
      });
      setGeminiOauthState(null);
      setGeminiOauthCode('');
      setNotice(t('settings.runtime.notice.geminiOauthLoginSuccess'));
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.geminiOauthCallbackFailed')));
    } finally {
      setGeminiOauthExchanging(false);
    }
  };

  const handleSaveThirdParty = async () => {
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      await api.put<RuntimeConfigPublic>(getRuntimeConfigEndpoint(), {
        anthropicBaseUrl: baseUrl,
      });

      const saved = await api.put<RuntimeConfigPublic>(
        getRuntimeSecretsEndpoint(),
        buildThirdPartySecretsPayload({
          authTokenDirty,
          authToken,
        }),
      );
      setConfig(saved);

      const customEnv: Record<string, string> = {};
      for (const row of customEnvRows) {
        const k = row.key.trim();
        if (!k) continue;
        customEnv[k] = row.value;
      }
      await api.put<RuntimeCustomEnvResp>(getRuntimeCustomEnvEndpoint(), { customEnv });

      setAuthToken('');
      setAuthTokenDirty(false);
      setClaudeAccessMode('third_party');
      setNotice(t('settings.runtime.notice.thirdPartySaved', { label: currentRuntime.label }));
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.saveThirdPartyFailed')));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSdkRuntime = async () => {
    const isCodexRuntime = engineMode === 'codex';
    const keyValue = isCodexRuntime ? codexApiKey.trim() : geminiApiKey.trim();
    const keyDirty = isCodexRuntime ? codexApiKeyDirty : geminiApiKeyDirty;
    const hasSavedKey = isCodexRuntime
      ? !!config?.hasCodexApiKey
      : !!config?.hasGeminiApiKey;
    const keyName = isCodexRuntime ? 'CODEX_API_KEY' : 'GEMINI_API_KEY';
    const requiresApiKey =
      isCodexRuntime || effectiveGeminiAccessMode === 'api_key';
    if (requiresApiKey && !keyDirty && !hasSavedKey && !keyValue) {
      setError(t('settings.runtime.errors.apiKeyRequired', { label: currentRuntime.label, keyName }));
      return;
    }
    if (requiresApiKey && keyDirty && keyValue && looksLikeHttpUrl(keyValue)) {
      setError(t('settings.runtime.errors.apiKeyInvalid', { keyName }));
      return;
    }

    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const providerSaved = await api.put<RuntimeConfigPublic>(
        getRuntimeConfigEndpoint(),
        isCodexRuntime
          ? {
            codexBaseUrl,
            codexModel,
          }
          : {
            geminiBaseUrl: geminiBaseUrl.trim(),
            geminiModel,
            geminiAuthMode: effectiveGeminiAccessMode,
          },
      );

      const secretsPayload = isCodexRuntime
        ? buildCodexSecretsPayload({
          codexApiKeyDirty: keyDirty,
          codexApiKey: keyValue,
        })
        : buildGeminiSecretsPayload({
          geminiAuthMode: effectiveGeminiAccessMode,
          geminiApiKeyDirty: keyDirty,
          geminiApiKey: keyValue,
          hasGeminiApiKey: hasSavedKey,
        });

      if (hasSecretPayloadChanges(secretsPayload)) {
        const saved = await api.put<RuntimeConfigPublic>(
          getRuntimeSecretsEndpoint(),
          secretsPayload,
        );
        setConfig(saved);
      } else {
        setConfig(providerSaved);
      }

      setCodexApiKey('');
      setCodexApiKeyDirty(false);
      setGeminiApiKey('');
      setGeminiApiKeyDirty(false);
      await api.put<RuntimeCustomEnvResp>(getRuntimeCustomEnvEndpoint(), {
        customEnv: {},
      });
      setNotice(t('settings.runtime.notice.runtimeSaved', { label: currentRuntime.label }));
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.saveRuntimeFailed', { label: currentRuntime.label })));
    } finally {
      setSaving(false);
    }
  };

  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const controlsBusy = loading || saving || applying;

  const doApply = async () => {
    setShowApplyConfirm(false);
    setApplying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.post<RuntimeApplyResult>(getRuntimeApplyEndpoint());
      if (result.success) {
        setNotice(t('settings.runtime.notice.applySuccess', { stoppedCount: result.stoppedCount }));
      } else {
        const suffix = typeof result.failedCount === 'number'
          ? t('settings.runtime.applyFailedSuffix', { failedCount: result.failedCount })
          : '';
        setError(result.error || t('settings.runtime.errors.applyPartialFailed', { suffix }));
      }
    } catch (err) {
      setError(getErrorMessage(err, t('settings.runtime.errors.applyFailed')));
    } finally {
      setApplying(false);
    }
  };

  const handleApply = () => setShowApplyConfirm(true);

  const addRow = () => setCustomEnvRows((prev) => [...prev, { key: '', value: '' }]);
  const removeRow = (index: number) => setCustomEnvRows((prev) => prev.filter((_, i) => i !== index));
  const updateRow = (index: number, field: keyof EnvRow, value: string) =>
    setCustomEnvRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

  return (
    <div className="space-y-4">
      <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2.5">
        <div className="text-xs font-medium text-foreground">{t('settings.runtime.globalDefaultTitle')}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('settings.runtime.currentSaved', { label: savedRuntimeLabel })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('settings.runtime.globalHint')}
        </div>
      </div>

      <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
        {runtimeOptions.map((runtime) => (
          <button
            key={runtime.id}
            type="button"
            disabled={controlsBusy}
            onClick={() => setEngineMode(runtime.id)}
            className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
              engineMode === runtime.id
                ? 'bg-card text-brand-700 shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {runtime.label}
          </button>
        ))}
      </div>

      <div className="surface-card-soft rounded-xl border border-border/70 bg-muted/15 p-3">
        <div className="mb-2 text-xs text-muted-foreground">
          {t('settings.runtime.switchHint')}
        </div>
        <Button
          variant="outline"
          onClick={handleSaveDefaultRuntime}
          disabled={loading || saving || applying || config?.agentRuntime === engineMode}
          className="h-10 rounded-xl"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving
            ? t('settings.runtime.saving')
            : t('settings.runtime.setDefault', { label: currentRuntime.label })}
        </Button>
      </div>

      {supportsOfficialAuth || supportsThirdPartyGateway ? (
        <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('setupProviders.runtime.claude.title')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway
                  ? t('setupProviders.runtime.claude.officialDescription')
                  : t('setupProviders.runtime.claude.thirdPartyDescription')}
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              (effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway)
                ? claudeOfficialDraftReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-border/70 bg-card/75 text-muted-foreground'
                : claudeThirdPartyDraftReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {(effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway)
                ? claudeOfficialDraftReady ? configuredText : notConfiguredText
                : claudeThirdPartyDraftReady ? configuredText : notConfiguredText}
            </span>
          </div>

          {supportsOfficialAuth && supportsThirdPartyGateway && (
            <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
              <button
                type="button"
                disabled={controlsBusy}
                onClick={() => setClaudeAccessMode('official')}
                className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  effectiveClaudeAccessMode === 'official'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('setupProviders.runtime.claude.tabOfficial')}
              </button>
              <button
                type="button"
                disabled={controlsBusy}
                onClick={() => setClaudeAccessMode('third_party')}
                className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  effectiveClaudeAccessMode === 'third_party'
                    ? 'bg-card text-brand-700 shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('setupProviders.runtime.claude.tabThirdParty')}
              </button>
            </div>
          )}

          {(effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway) ? (
            <div className="rounded-lg space-y-4 bg-muted/15 p-4">
              {config?.hasRuntimeOAuthCredentials && (
                <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-1">
                  <div className="text-sm font-medium text-emerald-800">{t('settings.runtime.oauthCredentialsTitle')}</div>
                  <div className="text-xs text-emerald-700">
                    {t('settings.runtime.accessTokenLabel')} {config.claudeOAuthCredentialsAccessTokenMasked || '***'}
                  </div>
                  {config.claudeOAuthCredentialsExpiresAt && (
                    <div className="text-xs text-emerald-700">
                      {t('settings.runtime.expiresAtLabel')} {new Date(config.claudeOAuthCredentialsExpiresAt).toLocaleString(localeForDateTime(locale))}
                      {config.claudeOAuthCredentialsExpiresAt > Date.now()
                        ? t('settings.runtime.expiresInMinutes', {
                          minutes: Math.round((config.claudeOAuthCredentialsExpiresAt - Date.now()) / 60000),
                        })
                        : t('settings.runtime.expiredWaitingRefresh')}
                    </div>
                  )}
                  <div className="text-xs text-emerald-600">{t('settings.runtime.oauthAutoRefreshHint')}</div>
                </div>
              )}

              {supportsOAuthLogin && (
                <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/60 p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">{t('setupProviders.runtime.claude.oauth.title')}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('setupProviders.runtime.claude.oauth.description')}
                  </div>

                  {!oauthState ? (
                    <Button
                      onClick={handleOAuthStart}
                      disabled={controlsBusy || oauthLoading || oauthExchanging}
                      className="h-10 rounded-xl"
                    >
                      {oauthLoading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                      {oauthLoading ? t('settings.runtime.openingAuth') : t('setupProviders.runtime.claude.oauth.start')}
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        {t('setupProviders.runtime.claude.oauth.windowOpened')}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="text"
                          value={oauthCode}
                          onChange={(e) => setOauthCode(e.target.value)}
                          disabled={controlsBusy || oauthExchanging}
                          placeholder={t('setupProviders.runtime.claude.oauth.codePlaceholder')}
                          className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
                        />
                        <Button
                          onClick={handleOAuthCallback}
                          disabled={controlsBusy || oauthExchanging || !oauthCode.trim()}
                          className="h-10 rounded-xl"
                        >
                          {oauthExchanging && <Loader2 className="size-4 animate-spin" />}
                          {oauthExchanging ? t('settings.runtime.confirming') : t('setupProviders.common.confirm')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={controlsBusy || oauthExchanging}
                          className="h-10 rounded-xl"
                          onClick={() => { setOauthState(null); setOauthCode(''); }}
                        >
                          {t('setupProviders.common.cancel')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="relative flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex-1 border-t border-border" />
                {t('settings.runtime.orManualCredentials')}
                <div className="flex-1 border-t border-border" />
              </div>

              <div className="rounded-lg bg-muted/10 p-3">
                <label className="mb-1 block text-xs font-medium text-foreground/80">
                  {t('setupProviders.runtime.claude.tokenLabel')}{' '}
                  {config?.hasClaudeCodeOauthToken ? `(${config.claudeCodeOauthTokenMasked})` : ''}
                </label>
                <Input
                  type="password"
                  value={officialCode}
                  onChange={(e) => setOfficialCode(e.target.value)}
                  disabled={controlsBusy}
                  placeholder={config?.hasClaudeCodeOauthToken || config?.hasRuntimeOAuthCredentials
                    ? t('settings.runtime.overridePlaceholder')
                    : t('setupProviders.runtime.claude.tokenPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('setupProviders.runtime.claude.tokenHint')}
                </p>
              </div>

              <Button
                onClick={handleSaveOfficial}
                disabled={controlsBusy || oauthExchanging || oauthLoading}
                className="h-10 rounded-xl"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? t('settings.runtime.saving') : t('settings.runtime.saveCredentials')}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg space-y-4 bg-muted/15 p-4">
              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">{t('setupProviders.runtime.claude.baseUrlLabel')}</label>
                <Input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  disabled={controlsBusy}
                  placeholder={t('setupProviders.runtime.claude.baseUrlPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
                </div>

                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">
                    ANTHROPIC_AUTH_TOKEN {config?.hasAnthropicAuthToken ? `(${config.anthropicAuthTokenMasked})` : ''}
                  </label>
                  <Input
                    type="password"
                    value={authToken}
                    onChange={(e) => {
                      setAuthToken(e.target.value);
                      setAuthTokenDirty(true);
                    }}
                    disabled={controlsBusy}
                    placeholder={config?.hasAnthropicAuthToken
                      ? t('settings.runtime.keepOrClearPlaceholder')
                      : t('setupProviders.runtime.claude.authTokenPlaceholder')}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              </div>

              <div className="rounded-lg space-y-3 bg-muted/15 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">{t('setupProviders.runtime.claude.customEnvLabel')}</label>
                  <button
                    type="button"
                    onClick={addRow}
                    disabled={controlsBusy}
                    className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('setupProviders.common.add')}
                  </button>
                </div>

                {customEnvRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('setupProviders.common.empty')}</p>
                ) : (
                  <div className="space-y-2">
                    {customEnvRows.map((row, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <Input
                          type="text"
                          value={row.key}
                          onChange={(e) => updateRow(idx, 'key', e.target.value)}
                          placeholder={t('setupProviders.runtime.claude.customEnvKeyPlaceholder')}
                          className="h-9 w-full rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono sm:w-[38%]"
                          disabled={controlsBusy}
                        />
                        <Input
                          type="text"
                          value={row.value}
                          onChange={(e) => updateRow(idx, 'value', e.target.value)}
                          placeholder={t('setupProviders.runtime.claude.customEnvValuePlaceholder')}
                          className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono"
                          disabled={controlsBusy}
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          disabled={controlsBusy}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={t('setupProviders.runtime.claude.removeEnvAria')}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button
                onClick={handleSaveThirdParty}
                disabled={controlsBusy || oauthExchanging || oauthLoading}
                className="h-10 rounded-xl"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? t('settings.runtime.saving') : t('settings.runtime.saveThirdParty')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{t('setupProviders.runtime.generic.title', { label: currentRuntime.label })}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isGeminiRuntime
                  ? t('settings.runtime.generic.geminiDescription', { label: currentRuntime.label })
                  : t('settings.runtime.generic.codexDescription', { label: currentRuntime.label })}
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              sdkRuntimeDraftReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {sdkRuntimeDraftReady ? configuredText : notConfiguredText}
            </span>
          </div>

          <div className="rounded-lg space-y-4 bg-muted/15 p-4">
            {isGeminiRuntime && (
              <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
                <button
                  type="button"
                  disabled={controlsBusy}
                  onClick={() => setGeminiAccessMode('oauth')}
                  className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                    effectiveGeminiAccessMode === 'oauth'
                      ? 'bg-card text-brand-700 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('setupProviders.runtime.gemini.tabOfficial')}
                </button>
                <button
                  type="button"
                  disabled={controlsBusy}
                  onClick={() => setGeminiAccessMode('api_key')}
                  className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                    effectiveGeminiAccessMode === 'api_key'
                      ? 'bg-card text-brand-700 shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('setupProviders.runtime.gemini.tabApiKey')}
                </button>
              </div>
            )}

            {isGeminiRuntime && effectiveGeminiAccessMode === 'oauth' && (
              <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/70 p-4 space-y-3">
                <div className="text-sm font-medium text-foreground/90">{t('setupProviders.runtime.gemini.officialTitle')}</div>
                <div className="text-xs text-muted-foreground">
                  {t('settings.runtime.gemini.oauthDescription')}
                </div>
                {geminiOAuthConfigured && (
                  <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    {t('settings.runtime.gemini.oauthConnected')}
                  </div>
                )}

                {!geminiOauthState ? (
                  <Button
                    onClick={handleGeminiOAuthStart}
                    disabled={controlsBusy || geminiOauthLoading || geminiOauthExchanging}
                    className="h-10 rounded-xl"
                  >
                    {geminiOauthLoading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                    {geminiOauthLoading ? t('settings.runtime.openingAuth') : t('settings.runtime.gemini.oneClickLogin')}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      {t('settings.runtime.gemini.oauthWindowOpened')}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={geminiOauthCode}
                        onChange={(e) => setGeminiOauthCode(e.target.value)}
                        disabled={controlsBusy || geminiOauthExchanging}
                        placeholder={t('settings.runtime.gemini.oauthCodePlaceholder')}
                        className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
                      />
                      <Button
                        onClick={handleGeminiOAuthCallback}
                        disabled={controlsBusy || geminiOauthExchanging || !geminiOauthCode.trim()}
                        className="h-10 rounded-xl"
                      >
                        {geminiOauthExchanging && <Loader2 className="size-4 animate-spin" />}
                        {geminiOauthExchanging ? t('settings.runtime.confirming') : t('setupProviders.common.confirm')}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={controlsBusy || geminiOauthExchanging}
                        className="h-10 rounded-xl"
                        onClick={() => { setGeminiOauthState(null); setGeminiOauthCode(''); }}
                      >
                        {t('setupProviders.common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  {t('settings.runtime.gemini.fallbackHint')}
                </div>
                {config?.hasGeminiApiKey && (
                  <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {t('settings.runtime.gemini.clearApiKeyHint')}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4">
              {(!isGeminiRuntime || effectiveGeminiAccessMode === 'api_key') && (
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">
                    {isGeminiRuntime ? 'GEMINI_API_KEY' : 'CODEX_API_KEY'}{' '}
                    {isGeminiRuntime
                      ? (config?.hasGeminiApiKey ? `(${config.geminiApiKeyMasked})` : '')
                      : (config?.hasCodexApiKey ? `(${config.codexApiKeyMasked})` : '')}
                  </label>
                  {(isGeminiRuntime ? config?.hasGeminiApiKey : config?.hasCodexApiKey) && (
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      {t('settings.runtime.currentSource')}{secretSourceLabel(sdkKeySource)}
                    </div>
                  )}
                  {sdkKeyDegraded && (
                    <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                      {t('settings.runtime.apiKeyDegraded')}
                    </div>
                  )}
                  <Input
                    type="password"
                    value={isGeminiRuntime ? geminiApiKey : codexApiKey}
                    onChange={(e) => {
                      if (isGeminiRuntime) {
                        setGeminiApiKey(e.target.value);
                        setGeminiApiKeyDirty(true);
                      } else {
                        setCodexApiKey(e.target.value);
                        setCodexApiKeyDirty(true);
                      }
                    }}
                    disabled={controlsBusy}
                    placeholder={
                      (isGeminiRuntime ? config?.hasGeminiApiKey : config?.hasCodexApiKey)
                        ? t('settings.runtime.keepCurrentPlaceholder')
                        : t('settings.runtime.enterApiKeyPlaceholder')
                    }
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              )}
              {isGeminiRuntime ? (
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">
                    {t('setupProviders.runtime.generic.geminiBaseUrlLabel')}
                  </label>
                  <Input
                    type="text"
                    value={geminiBaseUrl}
                    onChange={(e) => setGeminiBaseUrl(e.target.value)}
                    disabled={controlsBusy}
                    placeholder={t('setupProviders.runtime.generic.geminiBaseUrlPlaceholder')}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              ) : (
                currentRuntime.capabilities.supportsCustomBaseUrl && (
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="mb-1 block text-xs font-medium text-foreground/80">{t('setupProviders.runtime.generic.openaiBaseUrlLabel')}</label>
                    <Input
                      type="text"
                      value={codexBaseUrl}
                      onChange={(e) => setCodexBaseUrl(e.target.value)}
                      disabled={controlsBusy}
                      placeholder={t('setupProviders.runtime.generic.openaiBaseUrlPlaceholder')}
                      className="h-10 rounded-xl border-border/75 bg-card/95"
                    />
                  </div>
                )
              )}
              {supportsModelOverride && (
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">
                    {isGeminiRuntime
                      ? t('setupProviders.runtime.generic.geminiModelLabel')
                      : t('setupProviders.runtime.generic.codexModelLabel')}
                  </label>
                  <Input
                    type="text"
                    value={isGeminiRuntime ? geminiModel : codexModel}
                    onChange={(e) => {
                      if (isGeminiRuntime) {
                        setGeminiModel(e.target.value);
                      } else {
                        setCodexModel(e.target.value);
                      }
                    }}
                    disabled={controlsBusy}
                    placeholder={
                      isGeminiRuntime
                        ? t('setupProviders.runtime.generic.geminiModelPlaceholder')
                        : t('setupProviders.runtime.generic.codexModelPlaceholder')
                    }
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              )}
            </div>

            <Button
              onClick={handleSaveSdkRuntime}
              disabled={
                controlsBusy ||
                oauthExchanging ||
                oauthLoading ||
                geminiOauthExchanging ||
                geminiOauthLoading
              }
              className="h-10 rounded-xl"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? t('settings.runtime.saving') : t('settings.runtime.saveRuntimeConfig', { label: currentRuntime.label })}
            </Button>
          </div>
        </div>
      )}

      <div className="surface-card-soft flex flex-wrap items-center gap-3 rounded-xl border border-border/70 p-3">
        <Button
          variant="outline"
          onClick={() => void loadConfig({ preserveCurrentTab: true })}
          disabled={controlsBusy}
          className="h-10 rounded-xl"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? t('settings.runtime.loading') : t('settings.runtime.reload')}
        </Button>
        <Button variant="destructive" onClick={handleApply} disabled={controlsBusy} className="h-10 rounded-xl">
          {applying && <Loader2 className="size-4 animate-spin" />}
          <Rocket className="w-4 h-4" />
          {applying ? t('settings.runtime.applying') : t('settings.runtime.applyAll')}
        </Button>
      </div>

      <SettingsMetaGrid
        columns={1}
        className="max-w-sm"
        items={[{ label: t('settings.runtime.lastSaved'), value: updatedAt }]}
      />

      <ConfirmDialog
        open={showApplyConfirm}
        onClose={() => setShowApplyConfirm(false)}
        onConfirm={doApply}
        title={t('settings.runtime.applyConfirm.title')}
        message={t('settings.runtime.applyConfirm.message')}
        confirmText={t('settings.runtime.applyConfirm.confirm')}
        confirmVariant="danger"
        loading={applying}
      />
    </div>
  );
}
