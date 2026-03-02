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
import { looksLikeHttpUrl } from '../lib/runtime-input-validation';
import { useI18n, type MessageKey } from '../i18n';

type ClaudeAccessMode = 'official' | 'third_party';
type EngineMode = AgentRuntimeId;

interface EnvRow {
  key: string;
  value: string;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

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

function buildCustomEnv(
  rows: EnvRow[],
  t: Translate,
): { customEnv: Record<string, string>; error: string | null } {
  const customEnv: Record<string, string> = {};
  for (const [idx, row] of rows.entries()) {
    const key = row.key.trim();
    const value = row.value.trim();
    if (!key && !value) continue;
    if (!key || !value) {
      return { customEnv: {}, error: t('setupProviders.errors.envKeyValueRequired', { index: idx + 1 }) };
    }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return { customEnv: {}, error: t('setupProviders.errors.envKeyInvalid', { key }) };
    }
    if (RESERVED_ENV_KEYS.has(key)) {
      return { customEnv: {}, error: t('setupProviders.errors.envKeyReserved', { key }) };
    }
    if (customEnv[key] !== undefined) {
      return { customEnv: {}, error: t('setupProviders.errors.envKeyDuplicate', { key }) };
    }
    customEnv[key] = value;
  }
  return { customEnv, error: null };
}

export function SetupProvidersPage() {
  const { t } = useI18n();
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
        ? !!geminiApiKey.trim()
      : effectiveClaudeAccessMode === 'third_party'
        ? !!(baseUrl.trim() && authToken.trim())
        : oauthDone || !!officialToken.trim();
  const claudeOfficialDraftReady = oauthDone || !!officialToken.trim();
  const claudeThirdPartyDraftReady = !!(baseUrl.trim() && authToken.trim());
  const codexDraftReady = !!codexApiKey.trim();
  const geminiDraftReady = !!geminiApiKey.trim();

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
      setError(getErrorMessage(err, t('setupProviders.errors.oauthStartFailed')));
    } finally {
      setOauthLoading(false);
    }
  };

  const handleOAuthCallback = async () => {
    if (!oauthState || !oauthCode.trim()) {
      setError(t('setupProviders.errors.oauthCodeRequired'));
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
      setNotice(t('setupProviders.notice.oauthSuccess'));
    } catch (err) {
      setError(getErrorMessage(err, t('setupProviders.errors.oauthCallbackFailed')));
    } finally {
      setOauthExchanging(false);
    }
  };

  const handleFinish = async () => {
    setError(null);
    setNotice(null);

    if (feishuAppSecret.trim() && !feishuAppId.trim()) {
      setError(t('setupProviders.errors.feishuSecretNeedsAppId'));
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
      (!!geminiModelValue && geminiModelValue !== 'gemini-2.5-pro');

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
          setError(t('setupProviders.errors.claudeBaseUrlRequired'));
          return;
        }
        if (!authToken.trim()) {
          setError(t('setupProviders.errors.claudeAuthTokenRequired'));
          return;
        }
        const envResult = buildCustomEnv(customEnvRows, t);
        if (envResult.error) {
          setError(envResult.error);
          return;
        }
        customEnv = envResult.customEnv;
      } else if (claudeSupportsOfficial && !officialToken.trim() && !oauthDone) {
        setError(t('setupProviders.errors.claudeOfficialRequired'));
        return;
      }
    }

    if (wantsCodex && !codexApiKey.trim()) {
      setError(
        t('setupProviders.errors.codexApiKeyRequired', { label: codexRuntime?.label ?? 'Codex' }),
      );
      return;
    }
    if (wantsCodex && looksLikeHttpUrl(codexApiKey.trim())) {
      setError(t('setupProviders.errors.codexApiKeyInvalid'));
      return;
    }
    if (wantsGemini && !geminiApiKey.trim()) {
      setError(
        t('setupProviders.errors.geminiApiKeyRequired', {
          label: geminiRuntime?.label ?? 'Gemini',
        }),
      );
      return;
    }
    if (wantsGemini && looksLikeHttpUrl(geminiApiKey.trim())) {
      setError(t('setupProviders.errors.geminiApiKeyInvalid'));
      return;
    }

    if (!wantsClaude && !wantsCodex && !wantsGemini) {
      setError(t('setupProviders.errors.runtimeRequired'));
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
          geminiAuthMode: 'api_key',
        });
        await api.put(
          getRuntimeSecretsEndpoint(),
          buildGeminiSecretsPayload({
            geminiAuthMode: 'api_key',
            geminiApiKeyDirty: true,
            geminiApiKey: geminiApiKey.trim(),
            hasGeminiApiKey: false,
          }),
        );
      }

      await api.put(getRuntimeConfigEndpoint(), { agentRuntime: engineMode });

      await checkAuth();
      // Ensure setup status is refreshed before redirecting.
      const { setupStatus: latestStatus } = useAuthStore.getState();
      if (latestStatus?.needsSetup) {
        setError(t('setupProviders.errors.validationFailed'));
        return;
      }
      navigate('/settings?tab=runtime', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, t('setupProviders.errors.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen app-canvas overflow-y-auto px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        <div className="text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {t('setupProviders.page.step')}
          </p>
          <h1 className="text-2xl font-bold text-foreground mb-2">{t('setupProviders.page.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('setupProviders.page.subtitle')}</p>
        </div>

        <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/65 px-4 py-3 text-sm text-foreground/85">
          {t('setupProviders.page.hint')}
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
                <h2 className="text-sm font-semibold text-foreground">{t('setupProviders.feishu.title')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('setupProviders.feishu.subtitle')}</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              feishuDraftReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {feishuDraftReady ? t('setupProviders.common.ready') : t('setupProviders.common.pending')}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <p className="text-xs text-muted-foreground">{t('setupProviders.feishu.manualOnly')}</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  {t('setupProviders.feishu.appIdLabel')}
                </label>
                <Input
                  type="text"
                  value={feishuAppId}
                  onChange={(e) => setFeishuAppId(e.target.value)}
                  placeholder={t('setupProviders.feishu.appIdPlaceholder')}
                  className="h-10 rounded-xl border-border/75 bg-card/95"
                  disabled={saving}
                />
              </div>
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="block text-sm font-medium text-foreground/80 mb-1">
                  {t('setupProviders.feishu.appSecretLabel')}
                </label>
                <Input
                  type="password"
                  value={feishuAppSecret}
                  onChange={(e) => setFeishuAppSecret(e.target.value)}
                  placeholder={t('setupProviders.feishu.appSecretPlaceholder')}
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
                <h2 className="text-sm font-semibold text-foreground">{t('setupProviders.runtime.title')}</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">{t('setupProviders.runtime.subtitle')}</p>
              </div>
            </div>
            <span className={`hidden sm:inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              runtimeDraftReady
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {runtimeDraftReady ? t('setupProviders.common.ready') : t('setupProviders.common.pending')}
            </span>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="text-xs text-muted-foreground">
              {t('setupProviders.runtime.description')}
            </div>

            <div className="text-xs font-medium text-foreground/80">{t('setupProviders.runtime.defaultRuntime')}</div>

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
              {t('setupProviders.runtime.multiRuntimeHint')}
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
                      ? claudeOfficialDraftReady
                        ? t('setupProviders.common.ready')
                        : t('setupProviders.common.pending')
                      : claudeThirdPartyDraftReady
                        ? t('setupProviders.common.ready')
                        : t('setupProviders.common.pending')}
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
                      {t('setupProviders.runtime.claude.tabOfficial')}
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
                      {t('setupProviders.runtime.claude.tabThirdParty')}
                    </button>
                  </div>
                )}

                {(effectiveClaudeAccessMode === 'official' || !supportsThirdPartyGateway) ? (
                  <div className="space-y-4">
                    {/* OAuth one-click login */}
                    {supportsOAuthLogin && (
                      <div className="surface-card-soft rounded-xl space-y-3 border border-brand-200 bg-brand-50/70 p-4">
                        <div className="text-sm font-medium text-foreground/90">
                          {t('setupProviders.runtime.claude.oauth.title')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('setupProviders.runtime.claude.oauth.description')}
                        </div>

                        {oauthDone ? (
                          <div className="surface-card-soft rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                            {t('setupProviders.runtime.claude.oauth.success')}
                          </div>
                        ) : !oauthState ? (
                          <Button
                            onClick={handleOAuthStart}
                            disabled={oauthLoading || oauthExchanging || saving}
                            className="h-10 rounded-xl"
                          >
                            {oauthLoading ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                            {t('setupProviders.runtime.claude.oauth.start')}
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
                                disabled={oauthExchanging || saving}
                                placeholder={t('setupProviders.runtime.claude.oauth.codePlaceholder')}
                                className="h-10 flex-1 rounded-xl border-border/75 bg-card/95"
                              />
                              <Button
                                onClick={handleOAuthCallback}
                                disabled={oauthExchanging || saving || !oauthCode.trim()}
                                className="h-10 rounded-xl"
                              >
                                {oauthExchanging && <Loader2 className="size-4 animate-spin" />}
                                {t('setupProviders.common.confirm')}
                              </Button>
                              <Button
                                variant="outline"
                                disabled={saving}
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

                    <div className="relative flex items-center gap-3 text-xs text-muted-foreground/80">
                      <div className="flex-1 border-t border-border" />
                      {t('setupProviders.runtime.claude.orSetupToken')}
                      <div className="flex-1 border-t border-border" />
                    </div>

                    <div className="rounded-lg bg-muted/15 p-3 text-sm text-foreground/80">
                      <div className="font-medium mb-2">{t('setupProviders.runtime.claude.getCredentials')}</div>
                      <ol className="list-decimal ml-5 space-y-1 text-xs">
                        <li>{t('setupProviders.runtime.claude.guideInstall')}</li>
                        <li>{t('setupProviders.runtime.claude.guideLogin')}</li>
                        <li>
                          {t('setupProviders.runtime.claude.guideCredentialsJson')}
                        </li>
                        <li>
                          {t('setupProviders.runtime.claude.guideSetupToken')}
                        </li>
                      </ol>
                    </div>

                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        {t('setupProviders.runtime.claude.tokenLabel')}
                      </label>
                      <Input
                        type="password"
                        value={officialToken}
                        onChange={(e) => setOfficialToken(e.target.value)}
                        placeholder={t('setupProviders.runtime.claude.tokenPlaceholder')}
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                      <p className="text-xs text-muted-foreground/80 mt-1">
                        {t('setupProviders.runtime.claude.tokenHint')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="surface-card-soft flex items-center gap-2 border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-muted-foreground">
                      <Server className="w-4 h-4 text-primary" />
                      {t('setupProviders.runtime.claude.thirdPartyHint')}
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <div className="rounded-lg bg-muted/10 p-3">
                        <label className="block text-sm font-medium text-foreground/80 mb-1">
                          {t('setupProviders.runtime.claude.baseUrlLabel')}
                        </label>
                        <Input
                          type="text"
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                          placeholder={t('setupProviders.runtime.claude.baseUrlPlaceholder')}
                          className="h-10 rounded-xl border-border/75 bg-card/95"
                          disabled={saving}
                        />
                      </div>

                      <div className="rounded-lg bg-muted/10 p-3">
                        <label className="block text-sm font-medium text-foreground/80 mb-1">
                          {t('setupProviders.runtime.claude.authTokenLabel')}
                        </label>
                        <Input
                          type="password"
                          value={authToken}
                          onChange={(e) => setAuthToken(e.target.value)}
                          placeholder={t('setupProviders.runtime.claude.authTokenPlaceholder')}
                          className="h-10 rounded-xl border-border/75 bg-card/95"
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg space-y-3 bg-muted/15 p-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-muted-foreground">
                          {t('setupProviders.runtime.claude.customEnvLabel')}
                        </label>
                        <button
                          type="button"
                          onClick={addCustomEnvRow}
                          disabled={saving}
                          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {t('setupProviders.common.add')}
                        </button>
                      </div>

                      {customEnvRows.length === 0 ? (
                        <p className="text-xs text-muted-foreground/80">{t('setupProviders.common.empty')}</p>
                      ) : (
                        <div className="space-y-2">
                          {customEnvRows.map((row, idx) => (
                            <div key={idx} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <Input
                                type="text"
                                value={row.key}
                                onChange={(e) => updateCustomEnvRow(idx, 'key', e.target.value)}
                                placeholder={t('setupProviders.runtime.claude.customEnvKeyPlaceholder')}
                                className="h-9 w-full rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono sm:w-[38%]"
                                disabled={saving}
                              />
                              <Input
                                type="text"
                                value={row.value}
                                onChange={(e) => updateCustomEnvRow(idx, 'value', e.target.value)}
                                placeholder={t('setupProviders.runtime.claude.customEnvValuePlaceholder')}
                                className="h-9 flex-1 rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs font-mono"
                                disabled={saving}
                              />
                              <button
                                type="button"
                                onClick={() => removeCustomEnvRow(idx)}
                                disabled={saving}
                                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={t('setupProviders.runtime.claude.removeEnvAria')}
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
                    <h3 className="text-sm font-semibold text-foreground">
                      {t('setupProviders.runtime.generic.title', { label: currentRuntime.label })}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {engineMode === 'gemini'
                        ? t('setupProviders.runtime.generic.geminiDescription', {
                          label: currentRuntime.label,
                        })
                        : t('setupProviders.runtime.generic.codexDescription', {
                          label: currentRuntime.label,
                        })}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    (engineMode === 'gemini' ? geminiDraftReady : codexDraftReady)
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-border/70 bg-card/75 text-muted-foreground'
                  }`}>
                    {(engineMode === 'gemini' ? geminiDraftReady : codexDraftReady)
                      ? t('setupProviders.common.ready')
                      : t('setupProviders.common.pending')}
                  </span>
                </div>

                <div className="surface-card-soft flex items-center gap-2 border border-brand-200 bg-brand-50/60 px-3 py-2 text-xs text-muted-foreground">
                  <Server className="w-4 h-4 text-primary" />
                  {engineMode === 'gemini'
                    ? t('setupProviders.runtime.generic.geminiApiHint')
                    : t('setupProviders.runtime.generic.codexHint')}
                </div>

                <div className="grid grid-cols-1 gap-3">
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="block text-sm font-medium text-foreground/80 mb-1">
                      {engineMode === 'gemini'
                        ? t('setupProviders.runtime.generic.geminiApiKeyLabel')
                        : t('setupProviders.runtime.generic.codexApiKeyLabel')}
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
                      placeholder={
                        engineMode === 'gemini'
                          ? t('setupProviders.runtime.generic.geminiApiKeyPlaceholder')
                          : t('setupProviders.runtime.generic.codexApiKeyPlaceholder')
                      }
                      className="h-10 rounded-xl border-border/75 bg-card/95"
                      disabled={saving}
                    />
                  </div>
                  {engineMode === 'gemini' && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        {t('setupProviders.runtime.generic.geminiBaseUrlLabel')}
                      </label>
                      <div className="mb-2 text-xs text-muted-foreground">
                        {t('setupProviders.runtime.generic.geminiBaseUrlApiKeyOnly')}
                      </div>
                      <Input
                        type="text"
                        value={geminiBaseUrl}
                        onChange={(e) => setGeminiBaseUrl(e.target.value)}
                        placeholder={t('setupProviders.runtime.generic.geminiBaseUrlPlaceholder')}
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                    </div>
                  )}
                  {engineMode !== 'gemini' && currentRuntime.capabilities.supportsCustomBaseUrl && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        {t('setupProviders.runtime.generic.openaiBaseUrlLabel')}
                      </label>
                      <Input
                        type="text"
                        value={codexBaseUrl}
                        onChange={(e) => setCodexBaseUrl(e.target.value)}
                        placeholder={t('setupProviders.runtime.generic.openaiBaseUrlPlaceholder')}
                        className="h-10 rounded-xl border-border/75 bg-card/95"
                        disabled={saving}
                      />
                    </div>
                  )}
                  {supportsModelOverride && (
                    <div className="rounded-lg bg-muted/10 p-3">
                      <label className="block text-sm font-medium text-foreground/80 mb-1">
                        {engineMode === 'gemini'
                          ? t('setupProviders.runtime.generic.geminiModelLabel')
                          : t('setupProviders.runtime.generic.codexModelLabel')}
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
                        placeholder={
                          engineMode === 'gemini'
                            ? t('setupProviders.runtime.generic.geminiModelPlaceholder')
                            : t('setupProviders.runtime.generic.codexModelPlaceholder')
                        }
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
            {t('setupProviders.footer.summary')}
          </div>
          <Button onClick={handleFinish} disabled={saving} className="h-10 w-full rounded-xl md:w-auto md:min-w-64">
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t('setupProviders.footer.save')}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
