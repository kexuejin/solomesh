import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Loader2, Plus, Server, ShieldCheck, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../api/client';
import {
  DEFAULT_RUNTIME_DEFINITIONS,
  normalizeRuntimeDefinitions,
  type AgentRuntimeId,
  type RuntimeDefinition,
} from '../runtime-definitions';
import {
  getRuntimeConfigEndpoint,
  getRuntimeCustomEnvEndpoint,
  getRuntimeSecretsEndpoint,
} from '../api/runtime-endpoints';
import {
  buildCodexSecretsPayload,
  buildGeminiSecretsPayload,
  buildOfficialOauthSecretsPayload,
  buildOfficialSetupTokenSecretsPayload,
  buildThirdPartySecretsPayload,
} from '../components/settings/provider-secrets-payloads';
import { useAuthStore } from '../stores/auth';

type ClaudeAccessMode = 'official' | 'third_party';
type GeminiAccessMode = 'api_key' | 'oauth';
type EngineMode = AgentRuntimeId;

interface EnvRow {
  key: string;
  value: string;
}

const RESERVED_ENV_KEYS = new Set([
  'AGENT_RUNTIME',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'CODEX_MODEL',
  'GEMINI_API_KEY',
  'GOOGLE_GEMINI_BASE_URL',
  'GEMINI_MODEL',
]);

function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function buildCustomEnv(rows: EnvRow[]): { customEnv: Record<string, string>; error: string | null } {
  const customEnv: Record<string, string> = {};
  for (const [idx, row] of rows.entries()) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) continue;
    if (!key || !value) {
      return { customEnv: {}, error: `第 ${idx + 1} 行环境变量的 Key 和 Value 都要填写` };
    }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return { customEnv: {}, error: `环境变量 Key "${key}" 格式无效（仅允许大写字母/数字/下划线，且不能数字开头）` };
    }
    if (RESERVED_ENV_KEYS.has(key)) {
      return { customEnv: {}, error: `${key} 属于系统保留字段，请在必填区域填写` };
    }
    if (customEnv[key] !== undefined) {
      return { customEnv: {}, error: `环境变量 Key "${key}" 重复` };
    }
    customEnv[key] = value;
  }
  return { customEnv, error: null };
}

export function SetupProvidersPage() {
  const navigate = useNavigate();
  const { user, setupStatus, checkAuth, initialized } = useAuthStore();

  const [engineMode, setEngineMode] = useState<EngineMode>('claude');
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDefinition[]>([]);
  const [claudeAccessMode, setClaudeAccessMode] = useState<ClaudeAccessMode>('official');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Feishu (no prefilled defaults)
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');

  // Official mode
  const [officialToken, setOfficialToken] = useState('');

  // OAuth flow state
  const [oauthLoading, setOauthLoading] = useState(false);
  const [oauthState, setOauthState] = useState<string | null>(null);
  const [oauthCode, setOauthCode] = useState('');
  const [oauthExchanging, setOauthExchanging] = useState(false);
  const [oauthDone, setOauthDone] = useState(false);

  // Third-party mode
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [customEnvRows, setCustomEnvRows] = useState<EnvRow[]>([]);

  // Codex mode
  const [codexApiKey, setCodexApiKey] = useState('');
  const [codexBaseUrl, setCodexBaseUrl] = useState('');
  const [codexModel, setCodexModel] = useState('gpt-5-codex');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-pro');
  const [geminiAccessMode, setGeminiAccessMode] = useState<GeminiAccessMode>('api_key');

  useEffect(() => {
    if (user === null && initialized === true) {
      navigate('/login', { replace: true });
    } else if (user && user.role !== 'admin') {
      navigate('/chat', { replace: true });
    }
  }, [user, initialized, navigate]);

  useEffect(() => {
    if (setupStatus && !setupStatus.needsSetup) {
      navigate('/settings?tab=runtime', { replace: true });
    }
  }, [setupStatus, navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadRuntimes = async () => {
      try {
        const data = await api.get<{
          runtimes: RuntimeDefinition[];
          activeRuntime: EngineMode;
        }>('/api/config/runtimes');
        if (cancelled) return;
        const runtimes = normalizeRuntimeDefinitions(data.runtimes);
        if (runtimes.length > 0) {
          setRuntimeDefinitions(runtimes);
          setEngineMode((prev) => {
            if (runtimes.some((item) => item.id === prev)) return prev;
            const active = runtimes.find((item) => item.id === data.activeRuntime);
            return active?.id ?? runtimes[0].id;
          });
          return;
        }
      } catch {
        // Fall through to default runtime definitions.
      }
      if (!cancelled) {
        setRuntimeDefinitions([]);
      }
    };
    void loadRuntimes();
    return () => {
      cancelled = true;
    };
  }, []);

  const runtimeOptions = runtimeDefinitions.length > 0
    ? runtimeDefinitions
    : DEFAULT_RUNTIME_DEFINITIONS;
  const currentRuntime = useMemo(
    () =>
      runtimeOptions.find((item) => item.id === engineMode) ??
      runtimeOptions[0] ??
      DEFAULT_RUNTIME_DEFINITIONS[0],
    [runtimeOptions, engineMode],
  );
  const claudeRuntime = useMemo(
    () => runtimeOptions.find((item) => item.id === 'claude') ?? null,
    [runtimeOptions],
  );
  const codexRuntime = useMemo(
    () => runtimeOptions.find((item) => item.id === 'codex') ?? null,
    [runtimeOptions],
  );
  const geminiRuntime = useMemo(
    () => runtimeOptions.find((item) => item.id === 'gemini') ?? null,
    [runtimeOptions],
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
  const feishuDraftReady = !!(feishuAppId.trim() && feishuAppSecret.trim());
  const runtimeDraftReady =
    engineMode === 'codex'
      ? !!codexApiKey.trim()
      : engineMode === 'gemini'
        ? (geminiAccessMode === 'oauth' ? true : !!geminiApiKey.trim())
      : effectiveClaudeAccessMode === 'third_party'
        ? !!(baseUrl.trim() && authToken.trim())
        : oauthDone || !!officialToken.trim();
  const claudeOfficialDraftReady = oauthDone || !!officialToken.trim();
  const claudeThirdPartyDraftReady = !!(baseUrl.trim() && authToken.trim());
  const codexDraftReady = !!codexApiKey.trim();
  const geminiDraftReady =
    geminiAccessMode === 'oauth' ? true : !!geminiApiKey.trim();

  const addCustomEnvRow = () => setCustomEnvRows((rows) => [...rows, { key: '', value: '' }]);
  const removeCustomEnvRow = (idx: number) =>
    setCustomEnvRows((rows) => rows.filter((_, i) => i !== idx));
  const updateCustomEnvRow = (idx: number, field: keyof EnvRow, value: string) =>
    setCustomEnvRows((rows) =>
      rows.map((row, i) => (i === idx ? { ...row, [field]: value } : row)),
    );

  const handleOAuthStart = async () => {
    setOauthLoading(true);
    setError(null);
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
    try {
      await api.post('/api/config/runtime/oauth/callback', {
        state: oauthState,
        code: oauthCode.trim(),
      });
      setOauthState(null);
      setOauthCode('');
      setOauthDone(true);
      setNotice('Claude OAuth 登录成功，token 已保存。');
    } catch (err) {
      setError(getErrorMessage(err, 'OAuth 授权码换取失败'));
    } finally {
      setOauthExchanging(false);
    }
  };

  const handleFinish = async () => {
    setError(null);
    setNotice(null);

    if (feishuAppSecret.trim() && !feishuAppId.trim()) {
      setError('填写飞书 Secret 时，App ID 也必须填写');
      return;
    }

    const hasCustomEnvInput = customEnvRows.some((row) => row.key.trim() || row.value.trim());
    const codexModelValue = codexModel.trim();
    const geminiModelValue = geminiModel.trim();
    const codexTouched =
      !!codexApiKey.trim() ||
      !!codexBaseUrl.trim() ||
      (!!codexModelValue && codexModelValue !== 'gpt-5-codex');
    const geminiTouched =
      !!geminiApiKey.trim() ||
      !!geminiBaseUrl.trim() ||
      (!!geminiModelValue && geminiModelValue !== 'gemini-2.5-pro') ||
      geminiAccessMode !== 'api_key';

    const wantsClaude =
      !!claudeRuntime &&
      (
        engineMode === 'claude' ||
        !!officialToken.trim() ||
        oauthDone ||
        (claudeAccessMode === 'third_party' &&
          (hasCustomEnvInput || !!baseUrl.trim() || !!authToken.trim()))
      );
    const wantsCodex =
      !!codexRuntime &&
      (engineMode === 'codex' || codexTouched);
    const wantsGemini =
      !!geminiRuntime &&
      (engineMode === 'gemini' || geminiTouched);

    let customEnv: Record<string, string> = {};
    if (wantsClaude) {
      const claudeSupportsThirdParty = !!claudeRuntime?.capabilities.supportsThirdPartyGateway;
      const claudeSupportsOfficial = !!claudeRuntime?.capabilities.supportsOfficialAuth;
      if (claudeAccessMode === 'third_party' && claudeSupportsThirdParty) {
        if (!baseUrl.trim()) {
          setError('第三方渠道必须填写 ANTHROPIC_BASE_URL');
          return;
        }
        if (!authToken.trim()) {
          setError('第三方渠道必须填写 ANTHROPIC_AUTH_TOKEN');
          return;
        }
        const envResult = buildCustomEnv(customEnvRows);
        if (envResult.error) {
          setError(envResult.error);
          return;
        }
        customEnv = envResult.customEnv;
      } else if (claudeSupportsOfficial && !officialToken.trim() && !oauthDone) {
        setError('Claude 官方渠道请通过一键登录或手动填写 setup-token / .credentials.json');
        return;
      }
    }

    if (wantsCodex && !codexApiKey.trim()) {
      setError(`${codexRuntime?.label ?? 'Codex'} 必须填写 CODEX_API_KEY`);
      return;
    }
    if (wantsGemini && geminiAccessMode === 'api_key' && !geminiApiKey.trim()) {
      setError(`${geminiRuntime?.label ?? 'Gemini CLI'} 必须填写 GEMINI_API_KEY`);
      return;
    }

    if (!wantsClaude && !wantsCodex && !wantsGemini) {
      setError('请至少配置一个 Runtime 的凭据后再继续');
      return;
    }

    setSaving(true);
    try {
      // Feishu is optional. Only save when user entered anything.
      if (feishuAppId.trim() || feishuAppSecret.trim()) {
        const payload: Record<string, string> = { appId: feishuAppId.trim() };
        if (feishuAppSecret.trim()) payload.appSecret = feishuAppSecret.trim();
        await api.put('/api/config/feishu', payload);
      }

      if (wantsClaude) {
        const useThirdParty =
          claudeAccessMode === 'third_party' &&
          !!claudeRuntime?.capabilities.supportsThirdPartyGateway;
        if (useThirdParty) {
          await api.put(getRuntimeConfigEndpoint(), { anthropicBaseUrl: baseUrl.trim() });
          await api.put(
            getRuntimeSecretsEndpoint(),
            buildThirdPartySecretsPayload({
              authTokenDirty: true,
              authToken: authToken.trim(),
            }),
          );
          await api.put(getRuntimeCustomEnvEndpoint(), { customEnv });
        } else {
          await api.put(getRuntimeConfigEndpoint(), { anthropicBaseUrl: '' });
          if (!oauthDone) {
            const trimmed = officialToken.trim();
            let credentialsSaved = false;
            if (trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                const oauth = parsed.claudeAiOauth as Record<string, unknown> | undefined;
                if (
                  oauth &&
                  typeof oauth.accessToken === 'string' &&
                  typeof oauth.refreshToken === 'string'
                ) {
                  const expiresAtRaw = oauth.expiresAt;
                  const expiresAtParsed =
                    typeof expiresAtRaw === 'string' || typeof expiresAtRaw === 'number'
                      ? new Date(expiresAtRaw).getTime()
                      : NaN;
                  await api.put(
                    getRuntimeSecretsEndpoint(),
                    buildOfficialOauthSecretsPayload({
                      accessToken: oauth.accessToken,
                      refreshToken: oauth.refreshToken,
                      expiresAt:
                        Number.isFinite(expiresAtParsed)
                          ? expiresAtParsed
                          : Date.now() + 8 * 60 * 60 * 1000,
                      scopes: Array.isArray(oauth.scopes)
                        ? oauth.scopes.filter(
                          (item): item is string => typeof item === 'string',
                        )
                        : [],
                    }),
                  );
                  credentialsSaved = true;
                }
              } catch {
                // Not valid JSON, fallback to setup-token mode.
              }
            }
            if (!credentialsSaved) {
              await api.put(
                getRuntimeSecretsEndpoint(),
                buildOfficialSetupTokenSecretsPayload(trimmed),
              );
            }
          }
          await api.put(getRuntimeCustomEnvEndpoint(), { customEnv: {} });
        }
      }

      if (wantsCodex) {
        await api.put(getRuntimeConfigEndpoint(), {
          codexBaseUrl: codexBaseUrl.trim(),
          codexModel: codexModelValue || 'gpt-5-codex',
        });
        await api.put(
          getRuntimeSecretsEndpoint(),
          buildCodexSecretsPayload({
            codexApiKeyDirty: true,
            codexApiKey: codexApiKey.trim(),
          }),
        );
      }

      if (wantsGemini) {
        await api.put(getRuntimeConfigEndpoint(), {
          geminiBaseUrl: geminiBaseUrl.trim(),
          geminiModel: geminiModelValue || 'gemini-2.5-pro',
          geminiAuthMode: geminiAccessMode,
        });
        await api.put(
          getRuntimeSecretsEndpoint(),
          buildGeminiSecretsPayload({
            geminiAuthMode: geminiAccessMode,
            geminiApiKeyDirty: true,
            geminiApiKey: geminiApiKey.trim(),
            hasGeminiApiKey: false,
          }),
        );
      }

      await api.put(getRuntimeConfigEndpoint(), { agentRuntime: engineMode });

      await checkAuth();
      // 确认 setupStatus 已更新后再跳转，避免 AuthGuard 检测到 needsSetup 仍为 true 导致重定向循环
      const { setupStatus: latestStatus } = useAuthStore.getState();
      if (latestStatus?.needsSetup) {
        setError('配置已保存但验证未通过，请检查填写的配置是否正确');
        return;
      }
      navigate('/settings?tab=runtime', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, '保存初始化配置失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">STEP 2 / 2</p>
          <h1 className="text-2xl font-bold text-foreground mb-2">系统接入初始化</h1>
          <p className="text-sm text-muted-foreground">此页面保存的是系统全局默认配置。完成后才进入正式后台。</p>
        </div>

        <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
          建议先完成 Runtime 凭据，再补充飞书。后续在设置页仍可随时修改所有项。
        </div>

        {error && (
          <div className="surface-card-soft rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${feishuDraftReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">飞书配置（可选）</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">系统全局默认飞书凭证</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              feishuDraftReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {feishuDraftReady ? '已填写' : '待填写'}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">首装不预填任何默认值，全部由你手动输入。</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="block text-sm font-medium text-foreground/80 mb-1">App ID</label>
                <Input
                  type="text"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                  placeholder="输入飞书 App ID"
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                  disabled={saving}
                />
              </div>
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="block text-sm font-medium text-foreground/80 mb-1">App Secret</label>
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

        <section className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 bg-muted/35 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${runtimeDraftReady ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Agent Runtime 配置</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">系统全局默认 Runtime 凭据</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              runtimeDraftReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {runtimeDraftReady ? '已填写' : '待填写'}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="text-xs text-muted-foreground">
              这里配置的是全局默认 Runtime。初始化完成后仍可在设置页调整，单个工作区也可单独覆盖。
            </div>

            <div className="text-xs font-medium text-foreground/80">选择全局默认 Runtime</div>

            <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
              {runtimeOptions.map((runtime) => (
                <button
                  key={runtime.id}
                  type="button"
                  onClick={() => setEngineMode(runtime.id)}
                  disabled={saving}
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

            <div className="text-xs text-muted-foreground">
              可先切换到 Claude/Codex/Gemini 分别填写凭据，本页保存时会将已填写项一起提交，不会互相清空。
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
                      ? claudeOfficialDraftReady ? '已填写' : '待填写'
                      : claudeThirdPartyDraftReady ? '已填写' : '待填写'}
                  </span>
                </div>

                {supportsOfficialAuth && supportsThirdPartyGateway && (
                  <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
                    <button
                      type="button"
                      onClick={() => setClaudeAccessMode('official')}
                      disabled={saving}
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
                      onClick={() => setClaudeAccessMode('third_party')}
                      disabled={saving}
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
                  <div className="space-y-4">
                    {/* OAuth one-click login */}
                    {supportsOAuthLogin && (
                      <div className="surface-card-soft rounded-xl space-y-3 border border-brand-200 bg-brand-50/70 p-4">
                        <div className="text-sm font-medium text-foreground/90">一键登录 Claude（推荐）</div>
                        <div className="text-xs text-muted-foreground">
                          点击按钮后会打开 claude.ai 授权页面，完成授权后将页面上显示的授权码粘贴回来。
                        </div>

                        {oauthDone ? (
                          <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            OAuth 登录成功，点击下方按钮完成配置。
                          </div>
                        ) : !oauthState ? (
                          <Button
                            onClick={handleOAuthStart}
                            disabled={oauthLoading || oauthExchanging || saving}
                            className="h-10 rounded-xl"
                          >
                            {oauthLoading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                            一键登录 Claude
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
                                disabled={oauthExchanging || saving}
                                placeholder="粘贴授权码"
                                className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
                              />
                              <Button
                                onClick={handleOAuthCallback}
                                disabled={oauthExchanging || saving || !oauthCode.trim()}
                                className="h-10 rounded-xl"
                              >
                                {oauthExchanging && <Loader2 className="size-4 animate-spin" />}
                                确认
                              </Button>
                              <Button
                                variant="outline"
                                disabled={saving}
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

                    <div className="relative flex items-center gap-3 text-xs text-muted-foreground/80">
                      <div className="flex-1 border-t border-border" />
                      或手动粘贴 setup-token
                      <div className="flex-1 border-t border-border" />
                    </div>

                    <div className="rounded-lg bg-muted/15 p-3 text-sm text-foreground/80">
                      <div className="font-medium mb-2">获取凭据</div>
                      <ol className="list-decimal ml-5 space-y-1 text-xs">
                        <li>在目标机器安装 Claude Code CLI（若未安装）。</li>
                        <li>在终端执行 <code>claude login</code> 完成账号登录。</li>
                        <li>
                          方式 A：执行 <code>cat ~/.claude/.credentials.json</code>，复制完整 JSON 内容到下方（推荐，支持自动续期）。
                        </li>
                        <li>
                          方式 B：执行 <code>claude setup-token</code>，复制输出 token 到下方。
                        </li>
                      </ol>
                    </div>

                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        setup-token 或 .credentials.json
                      </label>
                      <Input
                        type="password"
                        value={officialToken}
                        onChange={(e) => setOfficialToken(e.target.value)}
                        placeholder="粘贴 setup-token 或 cat ~/.claude/.credentials.json 输出"
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                      <p className="text-xs text-muted-foreground/80 mt-1">
                        支持粘贴 <code className="bg-muted px-1 rounded">cat ~/.claude/.credentials.json</code> 的 JSON 内容（含自动续期）
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="surface-card-soft flex items-center gap-2 border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-muted-foreground">
                      <Server className="w-4 h-4 text-primary" />
                      第三方渠道会写入系统全局默认环境变量。必填项为 ANTHROPIC_BASE_URL 和 ANTHROPIC_AUTH_TOKEN。
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-lg bg-muted/10 p-3">
                        <label className="block text-sm font-medium text-foreground/80 mb-1">ANTHROPIC_BASE_URL（必填）</label>
                        <Input
                          type="text"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder="https://your-relay.example.com/v1"
                          className="h-10 rounded-xl border-border/75 bg-card/95"
                          disabled={saving}
                        />
                      </div>

                      <div className="rounded-lg bg-muted/10 p-3">
                        <label className="block text-sm font-medium text-foreground/80 mb-1">ANTHROPIC_AUTH_TOKEN（必填）</label>
                        <Input
                          type="password"
                          value={authToken}
                          onChange={(e) => setAuthToken(e.target.value)}
                          placeholder="输入第三方网关 Token"
                          className="h-10 rounded-xl border-border/75 bg-card/95"
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg space-y-3 bg-muted/15 p-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">其他自定义环境变量（可选）</label>
                        <button
                          type="button"
                          onClick={addCustomEnvRow}
                          disabled={saving}
                          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          添加
                        </button>
                      </div>

                      {customEnvRows.length === 0 ? (
                        <p className="text-xs text-muted-foreground/80">暂无</p>
                      ) : (
                        <div className="space-y-2">
                          {customEnvRows.map((row, idx) => (
                            <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <Input
                                type="text"
                                value={row.key}
                                onChange={(e) => updateCustomEnvRow(idx, 'key', e.target.value)}
                                placeholder="KEY"
                                className="h-9 w-full rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono sm:w-[38%]"
                                disabled={saving}
                              />
                              <Input
                                type="text"
                                value={row.value}
                                onChange={(e) => updateCustomEnvRow(idx, 'value', e.target.value)}
                                placeholder="value"
                                className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono"
                                disabled={saving}
                              />
                              <button
                                type="button"
                                onClick={() => removeCustomEnvRow(idx)}
                                disabled={saving}
                                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label="删除环境变量"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{currentRuntime.label} 凭据</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {engineMode === 'gemini'
                        ? `${currentRuntime.label} 使用 Gemini CLI。可切换 Google 官方 或 API Key 模式。`
                        : `${currentRuntime.label} 使用 OpenAI 兼容网关。至少填写 CODEX_API_KEY 即可完成初始化。`}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    (engineMode === 'gemini' ? geminiDraftReady : codexDraftReady)
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-border/70 bg-card/75 text-muted-foreground'
                  }`}>
                    {(engineMode === 'gemini' ? geminiDraftReady : codexDraftReady) ? '已填写' : '待填写'}
                  </span>
                </div>

                <div className="surface-card-soft flex items-center gap-2 border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-muted-foreground">
                  <Server className="w-4 h-4 text-primary" />
                  {engineMode === 'gemini'
                    ? (geminiAccessMode === 'oauth'
                      ? 'Google 官方模式不需要 GEMINI_API_KEY，需在执行环境完成 gemini login。'
                      : '可选项包含 GOOGLE_GEMINI_BASE_URL 与 GEMINI_MODEL；留空时会使用默认值。')
                    : '可选项包含 OPENAI_BASE_URL 与 CODEX_MODEL；留空时会使用默认值。'}
                </div>

                {engineMode === 'gemini' && (
                  <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
                    <button
                      type="button"
                      onClick={() => setGeminiAccessMode('oauth')}
                      disabled={saving}
                      className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                        geminiAccessMode === 'oauth'
                          ? 'bg-card text-brand-700 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Google 官方
                    </button>
                    <button
                      type="button"
                      onClick={() => setGeminiAccessMode('api_key')}
                      disabled={saving}
                      className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                        geminiAccessMode === 'api_key'
                          ? 'bg-card text-brand-700 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      API Key
                    </button>
                  </div>
                )}

                {engineMode === 'gemini' && geminiAccessMode === 'oauth' && (
                  <div className="surface-card-soft rounded-xl space-y-3 border border-brand-200 bg-brand-50/70 p-4">
                    <div className="text-sm font-medium text-foreground/90">Google 官方（推荐）</div>
                    <div className="text-xs text-muted-foreground">
                      使用 <code className="rounded bg-muted px-1">gemini login</code> 后，初始化流程只需保存模式与模型即可。
                    </div>
                    <div className="rounded-lg bg-muted/15 p-3 text-sm text-foreground/80">
                      <div className="font-medium mb-2">快速检查</div>
                      <ol className="list-decimal ml-5 space-y-1 text-xs">
                        <li>在目标机器执行 <code>gemini login</code> 并完成授权。</li>
                        <li>保持当前模式为 Google 官方，点击页面底部保存。</li>
                        <li>系统会自动尝试默认登录目录，无需手动配置路径。</li>
                      </ol>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3">
                  {(engineMode !== 'gemini' || geminiAccessMode === 'api_key') && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        {engineMode === 'gemini' ? 'GEMINI_API_KEY（必填）' : 'CODEX_API_KEY（必填）'}
                      </label>
                      <Input
                        type="password"
                        value={engineMode === 'gemini' ? geminiApiKey : codexApiKey}
                        onChange={(e) => {
                          if (engineMode === 'gemini') {
                            setGeminiApiKey(e.target.value);
                          } else {
                            setCodexApiKey(e.target.value);
                          }
                        }}
                        placeholder={engineMode === 'gemini' ? '输入 Gemini API Key' : '输入 Codex API Key'}
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                    </div>
                  )}
                  {engineMode === 'gemini' && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        GOOGLE_GEMINI_BASE_URL（可选）
                      </label>
                      <Input
                        type="text"
                        value={geminiBaseUrl}
                        onChange={(e) => setGeminiBaseUrl(e.target.value)}
                        placeholder="https://generativelanguage.googleapis.com"
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                    </div>
                  )}
                  {engineMode !== 'gemini' && currentRuntime.capabilities.supportsCustomBaseUrl && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">OPENAI_BASE_URL（可选）</label>
                      <Input
                        type="text"
                        value={codexBaseUrl}
                        onChange={(e) => setCodexBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                    </div>
                  )}
                  {supportsModelOverride && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        {engineMode === 'gemini' ? 'GEMINI_MODEL（可选）' : 'CODEX_MODEL（可选）'}
                      </label>
                      <Input
                        type="text"
                        value={engineMode === 'gemini' ? geminiModel : codexModel}
                        onChange={(e) => {
                          if (engineMode === 'gemini') {
                            setGeminiModel(e.target.value);
                          } else {
                            setCodexModel(e.target.value);
                          }
                        }}
                        placeholder={engineMode === 'gemini' ? 'gemini-2.5-pro' : 'gpt-5-codex'}
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="surface-card-soft flex flex-col gap-3 rounded-xl border border-border/70 p-4 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            当前页保存的数据会作为系统全局默认配置，后续可在后台设置页继续修改。
          </div>
          <Button onClick={handleFinish} disabled={saving} className="h-10 w-full rounded-xl md:w-auto md:min-w-64">
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存全局默认并进入后台
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
