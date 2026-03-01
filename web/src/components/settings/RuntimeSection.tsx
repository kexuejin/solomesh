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
import { getErrorMessage, runtimeSecretSourceLabel } from './types';
import { looksLikeHttpUrl } from '../../lib/runtime-input-validation';

type ClaudeAccessMode = 'official' | 'third_party';
type GeminiAccessMode = 'api_key' | 'oauth';
type EngineMode = AgentRuntimeId;

interface RuntimeSectionProps extends SettingsNotification {}

export function RuntimeSection({ setNotice, setError }: RuntimeSectionProps) {
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
      setError(getErrorMessage(err, '加载 Runtime 配置失败'));
    } finally {
      setLoading(false);
    }
  }, [setError]);

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
    if (!config?.updatedAt) return '未记录';
    return new Date(config.updatedAt).toLocaleString('zh-CN');
  }, [config?.updatedAt]);
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
      setNotice(`默认 Runtime 已更新为 ${currentRuntime.label}`);
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, '保存默认 Runtime 失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOfficial = async () => {
    if (!officialCode.trim()) {
      setError('请填写官方 setup-token 或粘贴 .credentials.json 内容');
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
            setNotice('Claude OAuth 凭据已保存（支持自动续期）');
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
        setNotice('Claude 凭据已保存');
        await loadConfig();
      }
    } catch (err) {
      setError(getErrorMessage(err, '保存官方 Runtime 配置失败'));
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
      setError(getErrorMessage(err, 'OAuth 授权启动失败'));
    } finally {
      setOauthLoading(false);
    }
  };

  const handleOAuthCallback = async () => {
    if (!oauthState || !oauthCode.trim()) {
      setError('请粘贴授权码');
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
      setNotice('Claude OAuth 登录成功');
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, 'OAuth 授权码换取失败'));
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
      setError(getErrorMessage(err, 'Gemini OAuth 授权启动失败'));
    } finally {
      setGeminiOauthLoading(false);
    }
  };

  const handleGeminiOAuthCallback = async () => {
    if (!geminiOauthState || !geminiOauthCode.trim()) {
      setError('请粘贴 Gemini 授权码');
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
      setNotice('Gemini OAuth 登录成功');
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, 'Gemini OAuth 授权码换取失败'));
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
      setNotice(`${currentRuntime.label} 第三方网关配置已保存`);
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, '保存第三方 Runtime 配置失败'));
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
      setError(`请填写 ${currentRuntime.label} 所需的 ${keyName}`);
      return;
    }
    if (requiresApiKey && keyDirty && keyValue && looksLikeHttpUrl(keyValue)) {
      setError(`${keyName} 不能填写 URL，请填写真实 API Key`);
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
      setNotice(`${currentRuntime.label} 配置已保存`);
      await loadConfig();
    } catch (err) {
      setError(getErrorMessage(err, `保存 ${currentRuntime.label} 配置失败`));
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
        setNotice(`Runtime 配置已应用，已停止 ${result.stoppedCount} 个运行中工作区`);
      } else {
        const suffix = typeof result.failedCount === 'number' ? `（失败 ${result.failedCount} 个）` : '';
        setError(result.error || `应用配置部分失败${suffix}`);
      }
    } catch (err) {
      setError(getErrorMessage(err, '应用配置失败'));
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
        <div className="text-xs font-medium text-foreground">全局默认 Runtime</div>
        <div className="mt-1 text-xs text-muted-foreground">
          当前已保存：
          {' '}
          {savedRuntimeLabel}
        </div>
        <div className="text-xs text-muted-foreground">
          工作区可在“环境变量”里单独覆盖；修改全局后需点击“应用到所有工作区”使运行中会话生效。
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
          切换上方 Runtime 仅用于编辑对应 Provider 配置；默认 Runtime 不会自动改变。
        </div>
        <Button
          variant="outline"
          onClick={handleSaveDefaultRuntime}
          disabled={loading || saving || applying || config?.agentRuntime === engineMode}
          className="h-10 rounded-xl"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {saving ? '保存中...' : `设为默认 Runtime（${currentRuntime.label}）`}
        </Button>
      </div>

      {supportsOfficialAuth || supportsThirdPartyGateway ? (
        <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Claude 凭据</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway
                  ? '使用 Claude 官方登录或 setup-token 作为系统默认凭据。'
                  : '使用第三方网关地址与 Token 作为系统默认 Claude 凭据。'}
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
                ? claudeOfficialDraftReady ? '已配置' : '未配置'
                : claudeThirdPartyDraftReady ? '已配置' : '未配置'}
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
                Claude 官方
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
                第三方网关
              </button>
            </div>
          )}

          {(effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway) ? (
            <div className="rounded-lg space-y-4 bg-muted/15 p-4">
              {config?.hasRuntimeOAuthCredentials && (
                <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-1">
                  <div className="text-sm font-medium text-emerald-800">OAuth 凭据（自动续期）</div>
                  <div className="text-xs text-emerald-700">
                    Access Token: {config.claudeOAuthCredentialsAccessTokenMasked || '***'}
                  </div>
                  {config.claudeOAuthCredentialsExpiresAt && (
                    <div className="text-xs text-emerald-700">
                      过期时间: {new Date(config.claudeOAuthCredentialsExpiresAt).toLocaleString('zh-CN')}
                      {config.claudeOAuthCredentialsExpiresAt > Date.now()
                        ? ` (${Math.round((config.claudeOAuthCredentialsExpiresAt - Date.now()) / 60000)} 分钟后)`
                        : ' (已过期，等待自动刷新)'}
                    </div>
                  )}
                  <div className="text-xs text-emerald-600">系统每 5 分钟检查一次，过期前 30 分钟内自动刷新。</div>
                </div>
              )}

              {supportsOAuthLogin && (
                <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/60 p-4 space-y-3">
                  <div className="text-sm font-medium text-foreground">一键登录 Claude（推荐）</div>
                  <div className="text-xs text-muted-foreground">
                    点击按钮后会打开 claude.ai 授权页面，完成授权后将页面上显示的授权码粘贴回来。
                  </div>

                  {!oauthState ? (
                    <Button
                      onClick={handleOAuthStart}
                      disabled={controlsBusy || oauthLoading || oauthExchanging}
                      className="h-10 rounded-xl"
                    >
                      {oauthLoading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                      {oauthLoading ? '打开授权中...' : '一键登录 Claude'}
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                        授权窗口已打开，请在 claude.ai 完成授权后，将页面上显示的授权码粘贴到下方。
                      </div>
                      <div className="flex gap-2">
                        <Input
                          type="text"
                          value={oauthCode}
                          onChange={(e) => setOauthCode(e.target.value)}
                          disabled={controlsBusy || oauthExchanging}
                          placeholder="粘贴授权码"
                          className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
                        />
                        <Button
                          onClick={handleOAuthCallback}
                          disabled={controlsBusy || oauthExchanging || !oauthCode.trim()}
                          className="h-10 rounded-xl"
                        >
                          {oauthExchanging && <Loader2 className="size-4 animate-spin" />}
                          {oauthExchanging ? '确认中...' : '确认'}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={controlsBusy || oauthExchanging}
                          className="h-10 rounded-xl"
                          onClick={() => { setOauthState(null); setOauthCode(''); }}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="relative flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex-1 border-t border-border" />
                或手动粘贴 setup-token / .credentials.json
                <div className="flex-1 border-t border-border" />
              </div>

              <div className="rounded-lg bg-muted/10 p-3">
                <label className="mb-1 block text-xs font-medium text-foreground/80">
                  setup-token 或 .credentials.json{' '}
                  {config?.hasClaudeCodeOauthToken ? `(${config.claudeCodeOauthTokenMasked})` : ''}
                </label>
                <Input
                  type="password"
                  value={officialCode}
                  onChange={(e) => setOfficialCode(e.target.value)}
                  disabled={controlsBusy}
                  placeholder={config?.hasClaudeCodeOauthToken || config?.hasRuntimeOAuthCredentials
                    ? '输入新值覆盖'
                    : '粘贴 setup-token 或 cat ~/.claude/.credentials.json 输出'}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  支持粘贴 <code className="rounded bg-muted px-1">cat ~/.claude/.credentials.json</code> 的 JSON 内容（含自动续期）
                </p>
              </div>

              <Button
                onClick={handleSaveOfficial}
                disabled={controlsBusy || oauthExchanging || oauthLoading}
                className="h-10 rounded-xl"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                {saving ? '保存中...' : '保存凭据'}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg space-y-4 bg-muted/15 p-4">
              <div className="grid grid-cols-1 gap-4">
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">ANTHROPIC_BASE_URL</label>
                  <Input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    disabled={controlsBusy}
                    placeholder="https://your-relay.example.com/v1"
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
                    placeholder={config?.hasAnthropicAuthToken ? '留空并保存可清空' : '输入 Token'}
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              </div>

              <div className="rounded-lg space-y-3 bg-muted/15 p-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">其他自定义环境变量</label>
                  <button
                    type="button"
                    onClick={addRow}
                    disabled={controlsBusy}
                    className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    添加
                  </button>
                </div>

                {customEnvRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">暂无</p>
                ) : (
                  <div className="space-y-2">
                    {customEnvRows.map((row, idx) => (
                      <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <Input
                          type="text"
                          value={row.key}
                          onChange={(e) => updateRow(idx, 'key', e.target.value)}
                          placeholder="KEY"
                          className="h-9 w-full rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono sm:w-[38%]"
                          disabled={controlsBusy}
                        />
                        <Input
                          type="text"
                          value={row.value}
                          onChange={(e) => updateRow(idx, 'value', e.target.value)}
                          placeholder="value"
                          className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono"
                          disabled={controlsBusy}
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          disabled={controlsBusy}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="删除环境变量"
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
                {saving ? '保存中...' : '保存第三方配置'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{currentRuntime.label} 凭据</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isGeminiRuntime
                  ? '使用 Gemini CLI。可切换 Google 官方 或 API Key 模式；支持可选自定义网关地址。'
                  : '使用 OpenAI 兼容网关。至少填写 CODEX_API_KEY 即可保存。'}
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              sdkRuntimeDraftReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {sdkRuntimeDraftReady ? '已配置' : '未配置'}
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
                  Google 官方
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
                  API Key
                </button>
              </div>
            )}

            {isGeminiRuntime && effectiveGeminiAccessMode === 'oauth' && (
              <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/70 p-4 space-y-3">
                <div className="text-sm font-medium text-foreground/90">Google 官方（推荐）</div>
                <div className="text-xs text-muted-foreground">
                  Google 官方模式不使用 <code className="rounded bg-muted px-1">GEMINI_API_KEY</code>，可直接一键登录并保存到系统运行目录。
                </div>
                {geminiOAuthConfigured && (
                  <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                    Google 官方登录已连接，可直接使用 Gemini CLI。
                  </div>
                )}

                {!geminiOauthState ? (
                  <Button
                    onClick={handleGeminiOAuthStart}
                    disabled={controlsBusy || geminiOauthLoading || geminiOauthExchanging}
                    className="h-10 rounded-xl"
                  >
                    {geminiOauthLoading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                    {geminiOauthLoading ? '打开授权中...' : '一键登录 Google'}
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      授权窗口已打开，请完成 Google 授权后将页面返回的授权码粘贴到下方。
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={geminiOauthCode}
                        onChange={(e) => setGeminiOauthCode(e.target.value)}
                        disabled={controlsBusy || geminiOauthExchanging}
                        placeholder="粘贴 Gemini 授权码"
                        className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
                      />
                      <Button
                        onClick={handleGeminiOAuthCallback}
                        disabled={controlsBusy || geminiOauthExchanging || !geminiOauthCode.trim()}
                        className="h-10 rounded-xl"
                      >
                        {geminiOauthExchanging && <Loader2 className="size-4 animate-spin" />}
                        {geminiOauthExchanging ? '确认中...' : '确认'}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={controlsBusy || geminiOauthExchanging}
                        className="h-10 rounded-xl"
                        onClick={() => { setGeminiOauthState(null); setGeminiOauthCode(''); }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}

                <div className="text-xs text-muted-foreground">
                  无法打开浏览器时，也可在目标环境手动执行 <code className="rounded bg-muted px-1">gemini login</code> 作为兜底。
                </div>
                {config?.hasGeminiApiKey && (
                  <div className="surface-card-soft rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    当前已存在 API Key，保存 Google 官方模式后会自动清空已存的 Key。
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
                      当前来源：{runtimeSecretSourceLabel(sdkKeySource)}
                    </div>
                  )}
                  {sdkKeyDegraded && (
                    <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
                      已保存的 Key 值无效，系统已自动回退到环境变量中的有效值。
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
                        ? '留空并保存可保持原值'
                        : '输入 API Key'
                    }
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              )}
              {isGeminiRuntime ? (
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">
                    GOOGLE_GEMINI_BASE_URL（可选）
                  </label>
                  <Input
                    type="text"
                    value={geminiBaseUrl}
                    onChange={(e) => setGeminiBaseUrl(e.target.value)}
                    disabled={controlsBusy}
                    placeholder="https://generativelanguage.googleapis.com"
                    className="h-10 rounded-xl border-border/75 bg-card/95"
                  />
                </div>
              ) : (
                currentRuntime.capabilities.supportsCustomBaseUrl && (
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="mb-1 block text-xs font-medium text-foreground/80">OPENAI_BASE_URL</label>
                    <Input
                      type="text"
                      value={codexBaseUrl}
                      onChange={(e) => setCodexBaseUrl(e.target.value)}
                      disabled={controlsBusy}
                      placeholder="https://api.openai.com/v1"
                      className="h-10 rounded-xl border-border/75 bg-card/95"
                    />
                  </div>
                )
              )}
              {supportsModelOverride && (
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="mb-1 block text-xs font-medium text-foreground/80">
                    {isGeminiRuntime ? 'GEMINI_MODEL' : 'CODEX_MODEL'}
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
                    placeholder={isGeminiRuntime ? 'gemini-2.5-pro' : 'gpt-5-codex'}
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
              {saving ? '保存中...' : `保存 ${currentRuntime.label} 配置`}
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
          {loading ? '加载中...' : '重新加载'}
        </Button>
        <Button variant="destructive" onClick={handleApply} disabled={controlsBusy} className="h-10 rounded-xl">
          {applying && <Loader2 className="size-4 animate-spin" />}
          <Rocket className="w-4 h-4" />
          {applying ? '应用中...' : '应用到所有工作区'}
        </Button>
      </div>

      <SettingsMetaGrid
        columns={1}
        className="max-w-sm"
        items={[{ label: '最近保存', value: updatedAt }]}
      />

      <ConfirmDialog
        open={showApplyConfirm}
        onClose={() => setShowApplyConfirm(false)}
        onConfirm={doApply}
        title="应用配置到所有工作区"
        message="这会停止所有活动工作区并清空其待处理队列，是否继续？"
        confirmText="确认应用"
        confirmVariant="danger"
        loading={applying}
      />
    </div>
  );
}
