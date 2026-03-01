import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Save, Plus, X, RefreshCw } from 'lucide-react';
import { useContainerEnvStore } from '../../stores/container-env';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '../../api/client';
import {
  DEFAULT_RUNTIME_DEFINITIONS,
  normalizeRuntimeDefinitions,
  type AgentRuntimeId,
  type RuntimeDefinition,
} from '../../runtime-definitions';

interface ContainerEnvPanelProps {
  groupJid: string;
  onClose?: () => void;
}

export function ContainerEnvPanel({ groupJid, onClose }: ContainerEnvPanelProps) {
  const { configs, loading, saving, loadConfig, saveConfig } = useContainerEnvStore();
  const config = configs[groupJid];

  // Draft state for form fields
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntimeId>('claude');
  const [runtimeDefinitions, setRuntimeDefinitions] = useState<RuntimeDefinition[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [authTokenDirty, setAuthTokenDirty] = useState(false);
  const [codexBaseUrl, setCodexBaseUrl] = useState('');
  const [codexModel, setCodexModel] = useState('');
  const [codexApiKey, setCodexApiKey] = useState('');
  const [codexApiKeyDirty, setCodexApiKeyDirty] = useState(false);
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('');
  const [geminiModel, setGeminiModel] = useState('');
  const [geminiAuthMode, setGeminiAuthMode] = useState<'api_key' | 'oauth'>('api_key');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiApiKeyDirty, setGeminiApiKeyDirty] = useState(false);
  const [customEnv, setCustomEnv] = useState<{ key: string; value: string }[]>([]);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (groupJid) loadConfig(groupJid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupJid]);

  useEffect(() => {
    let cancelled = false;
    const loadRuntimes = async () => {
      try {
        const data = await api.get<{ runtimes: RuntimeDefinition[] }>(
          '/api/config/runtimes',
        );
        if (!cancelled) {
          setRuntimeDefinitions(normalizeRuntimeDefinitions(data.runtimes));
        }
      } catch {
        if (!cancelled) {
          setRuntimeDefinitions(DEFAULT_RUNTIME_DEFINITIONS);
        }
      }
    };
    void loadRuntimes();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup save-success timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const runtimeOptions =
    runtimeDefinitions.length > 0
      ? runtimeDefinitions
      : DEFAULT_RUNTIME_DEFINITIONS;
  const currentRuntime = useMemo(
    () =>
      runtimeOptions.find((item) => item.id === agentRuntime) ??
      runtimeOptions[0] ??
      DEFAULT_RUNTIME_DEFINITIONS[0],
    [runtimeOptions, agentRuntime],
  );
  const usesAnthropicRuntime =
    currentRuntime.capabilities.supportsOfficialAuth ||
    currentRuntime.capabilities.supportsThirdPartyGateway;
  const isGeminiRuntime = agentRuntime === 'gemini';
  const controlsBusy = loading || saving;
  const anthropicDraftReady =
    !!config?.anthropicBaseUrl ||
    !!config?.hasAnthropicAuthToken ||
    !!baseUrl.trim() ||
    !!authToken.trim();
  const codexDraftReady = !!config?.hasCodexApiKey || !!codexApiKey.trim();
  const geminiDraftReady =
    geminiAuthMode === 'oauth'
      ? true
      : !!config?.hasGeminiApiKey || !!geminiApiKey.trim();
  const sdkDraftReady = isGeminiRuntime ? geminiDraftReady : codexDraftReady;

  useEffect(() => {
    if (!runtimeOptions.some((item) => item.id === agentRuntime)) {
      setAgentRuntime(runtimeOptions[0].id);
    }
  }, [runtimeOptions, agentRuntime]);

  // Sync config to draft when loaded
  useEffect(() => {
    if (!config) return;
    const nextRuntime = runtimeOptions.some((item) => item.id === config.agentRuntime)
      ? config.agentRuntime
      : runtimeOptions[0].id;
    setAgentRuntime(nextRuntime);
    setBaseUrl(config.anthropicBaseUrl || '');
    setAuthToken('');
    setAuthTokenDirty(false);
    setCodexBaseUrl(config.codexBaseUrl || '');
    setCodexModel(config.codexModel || '');
    setCodexApiKey('');
    setCodexApiKeyDirty(false);
    setGeminiBaseUrl(config.geminiBaseUrl || '');
    setGeminiModel(config.geminiModel || '');
    setGeminiAuthMode(config.geminiAuthMode || 'api_key');
    setGeminiApiKey('');
    setGeminiApiKeyDirty(false);
    const entries = Object.entries(config.customEnv || {}).map(([key, value]) => ({ key, value }));
    setCustomEnv(entries.length > 0 ? entries : []);
  }, [config, runtimeOptions]);

  const handleSave = async () => {
    const data: Record<string, unknown> = {};

    data.agentRuntime = agentRuntime;
    if (usesAnthropicRuntime) {
      if (currentRuntime.capabilities.supportsThirdPartyGateway) {
        data.anthropicBaseUrl = baseUrl;
      }
      // Only update secret when field has been edited.
      // If edited to empty string, backend will clear override and fall back to global.
      if (authTokenDirty) data.anthropicAuthToken = authToken;
    } else {
      if (!isGeminiRuntime && currentRuntime.capabilities.supportsCustomBaseUrl) {
        data.codexBaseUrl = codexBaseUrl;
      }
      if (currentRuntime.capabilities.supportsModelOverride) {
        if (isGeminiRuntime) {
          data.geminiBaseUrl = geminiBaseUrl;
          data.geminiModel = geminiModel;
          data.geminiAuthMode = geminiAuthMode;
        } else {
          data.codexModel = codexModel;
        }
      }
      if (isGeminiRuntime) {
        if (geminiAuthMode === 'api_key' && geminiApiKeyDirty) {
          data.geminiApiKey = geminiApiKey;
        }
      } else if (codexApiKeyDirty) {
        data.codexApiKey = codexApiKey;
      }
    }

    // Build custom env (filter empty keys)
    const envMap: Record<string, string> = {};
    for (const { key, value } of customEnv) {
      const k = key.trim();
      if (k) envMap[k] = value;
    }
    data.customEnv = envMap;

    const ok = await saveConfig(groupJid, data as {
      agentRuntime?: AgentRuntimeId;
      anthropicBaseUrl?: string;
      anthropicAuthToken?: string;
      codexBaseUrl?: string;
      codexModel?: string;
      codexApiKey?: string;
      geminiBaseUrl?: string;
      geminiModel?: string;
      geminiAuthMode?: 'api_key' | 'oauth';
      geminiApiKey?: string;
      customEnv?: Record<string, string>;
    });
    if (ok) {
      setSaveSuccess(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 2000);
      setAuthToken('');
      setAuthTokenDirty(false);
      setCodexApiKey('');
      setCodexApiKeyDirty(false);
      setGeminiApiKey('');
      setGeminiApiKeyDirty(false);
    }
  };

  const addCustomEnv = () => {
    setCustomEnv((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeCustomEnv = (index: number) => {
    setCustomEnv((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCustomEnv = (index: number, field: 'key' | 'value', val: string) => {
    setCustomEnv((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: val } : item))
    );
  };

  if (loading && !config) {
    return (
      <div className="p-4 text-sm text-muted-foreground text-center">加载中...</div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">工作区环境变量</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadConfig(groupJid)}
            className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-muted cursor-pointer"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-2 rounded-md hover:bg-muted cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          覆盖全局 Runtime 配置，仅对当前工作区生效。留空则使用全局配置。保存后工作区将自动重建。
        </p>

        {/* Runtime selector */}
        <div className="inline-flex rounded-[10px] border border-sidebar-border bg-background p-1">
          {runtimeOptions.map((runtime) => (
            <button
              key={runtime.id}
              type="button"
              onClick={() => setAgentRuntime(runtime.id)}
              className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer ${
                agentRuntime === runtime.id
                  ? 'bg-card text-brand-700 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {runtime.label}
            </button>
          ))}
        </div>

        {/* Runtime Fields */}
        <div className="rounded-xl space-y-4 border border-border/70 bg-muted/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">{currentRuntime.label} 凭据覆盖</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {usesAnthropicRuntime
                  ? '覆盖当前工作区的 Claude 凭据；未填写项会自动继承全局配置。'
                  : isGeminiRuntime
                    ? '覆盖当前工作区 Gemini 凭据；支持 Google 官方 与 API Key 两种模式。'
                    : '覆盖当前工作区 Codex 凭据；仅覆盖你填写的字段。'}
              </p>
            </div>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              usesAnthropicRuntime
                ? anthropicDraftReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-border/70 bg-card/75 text-muted-foreground'
                : sdkDraftReady
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-border/70 bg-card/75 text-muted-foreground'
            }`}>
              {usesAnthropicRuntime
                ? (anthropicDraftReady ? '已配置' : '未配置')
                : (sdkDraftReady ? '已配置' : '未配置')}
            </span>
          </div>

          {!usesAnthropicRuntime ? (
            <div className="rounded-lg space-y-4 bg-muted/15 p-4">
              {isGeminiRuntime && (
                <div className="inline-flex rounded-xl border border-border/70 bg-muted/60 p-1">
                  <button
                    type="button"
                    disabled={controlsBusy}
                    onClick={() => setGeminiAuthMode('oauth')}
                    className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                      geminiAuthMode === 'oauth'
                        ? 'bg-card text-brand-700 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Google 官方
                  </button>
                  <button
                    type="button"
                    disabled={controlsBusy}
                    onClick={() => setGeminiAuthMode('api_key')}
                    className={`h-9 px-3 text-sm rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                      geminiAuthMode === 'api_key'
                        ? 'bg-card text-brand-700 shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    API Key
                  </button>
                </div>
              )}

              {isGeminiRuntime && geminiAuthMode === 'oauth' && (
                <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/70 p-3 space-y-2">
                  <div className="text-xs font-medium text-foreground/90">Google 官方（推荐）</div>
                  <div className="text-[11px] text-muted-foreground">
                    先在执行环境完成 <code className="rounded bg-muted px-1">gemini login</code>，再保存当前模式。Google 官方模式不会使用 <code className="rounded bg-muted px-1">GEMINI_API_KEY</code>，系统会自动读取默认登录目录。
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3">
                {(!isGeminiRuntime || geminiAuthMode === 'api_key') && (
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      {isGeminiRuntime ? 'GEMINI_API_KEY' : 'CODEX_API_KEY'}
                      {(isGeminiRuntime ? config?.hasGeminiApiKey : config?.hasCodexApiKey) && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                          ({isGeminiRuntime ? config?.geminiApiKeyMasked : config?.codexApiKeyMasked})
                        </span>
                      )}
                    </label>
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
                      placeholder={
                        (isGeminiRuntime ? config?.hasGeminiApiKey : config?.hasCodexApiKey)
                          ? '已设置，输入新值覆盖；留空保持原值'
                          : '留空使用全局配置'
                      }
                      className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                      disabled={controlsBusy}
                    />
                  </div>
                )}
                {!isGeminiRuntime && currentRuntime.capabilities.supportsCustomBaseUrl && (
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      OPENAI_BASE_URL
                    </label>
                    <Input
                      type="text"
                      value={codexBaseUrl}
                      onChange={(e) => setCodexBaseUrl(e.target.value)}
                      placeholder="留空使用全局配置"
                      className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                      disabled={controlsBusy}
                    />
                  </div>
                )}
                {isGeminiRuntime && (
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
                      GOOGLE_GEMINI_BASE_URL
                    </label>
                    <Input
                      type="text"
                      value={geminiBaseUrl}
                      onChange={(e) => setGeminiBaseUrl(e.target.value)}
                      placeholder="留空使用全局配置"
                      className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                      disabled={controlsBusy}
                    />
                  </div>
                )}
                {currentRuntime.capabilities.supportsModelOverride && (
                  <div className="rounded-lg bg-muted/10 p-3">
                    <label className="block text-xs font-medium text-muted-foreground mb-1">
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
                      placeholder="留空使用全局配置"
                      className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                      disabled={controlsBusy}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg space-y-3 bg-muted/15 p-4">
              <div className="surface-card-soft rounded-xl border border-brand-200 bg-brand-50/60 px-3 py-2 text-[11px] text-muted-foreground">
                当前工作区填写的字段会覆盖全局配置；留空会自动继承全局值。
              </div>
              {currentRuntime.capabilities.supportsThirdPartyGateway && (
                <div className="rounded-lg bg-muted/10 p-3">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    ANTHROPIC_BASE_URL
                  </label>
                  <Input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="留空使用全局配置"
                    className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                    disabled={controlsBusy}
                  />
                </div>
              )}
              <div className="rounded-lg bg-muted/10 p-3">
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  ANTHROPIC_AUTH_TOKEN
                  {config?.hasAnthropicAuthToken && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                      ({config.anthropicAuthTokenMasked})
                    </span>
                  )}
                </label>
                <Input
                  type="password"
                  value={authToken}
                  onChange={(e) => {
                    setAuthToken(e.target.value);
                    setAuthTokenDirty(true);
                  }}
                  placeholder={config?.hasAnthropicAuthToken ? '已设置，输入新值覆盖；留空可清除覆盖' : '留空使用全局配置'}
                  className="h-9 rounded-lg border-border/75 bg-card/95 px-2.5 py-1.5 text-xs"
                  disabled={controlsBusy}
                />
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="border-t border-border/70" />

        {/* Custom Env Vars */}
        <div className="rounded-xl space-y-3 border border-border/70 bg-muted/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">自定义环境变量</label>
            <button
              type="button"
              onClick={addCustomEnv}
              className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-[11px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
            >
              <Plus className="w-3 h-3" />
              添加
            </button>
          </div>

          {customEnv.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">暂无自定义变量</p>
          ) : (
            <div className="space-y-1.5">
              {customEnv.map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    type="text"
                    value={item.key}
                    onChange={(e) => updateCustomEnv(i, 'key', e.target.value)}
                    placeholder="KEY"
                    className="h-8 w-[40%] rounded-lg border-border/75 bg-card px-2 py-1 text-[11px] font-mono"
                  />
                  <span className="text-muted-foreground/70 text-xs">=</span>
                  <Input
                    type="text"
                    value={item.value}
                    onChange={(e) => updateCustomEnv(i, 'value', e.target.value)}
                    placeholder="value"
                    className="h-8 flex-1 rounded-lg border-border/75 bg-card px-2 py-1 text-[11px] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeCustomEnv(i)}
                    className="flex-shrink-0 p-1 text-muted-foreground hover:text-red-500 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <Button onClick={handleSave} disabled={saving} className="h-10 w-full rounded-xl">
          {saving && <Loader2 className="size-4 animate-spin" />}
          <Save className="w-4 h-4" />
          {saveSuccess ? '已保存' : '保存并重建工作区'}
        </Button>
        {saveSuccess && (
          <p className="text-[11px] text-primary text-center mt-1.5">
            配置已保存，工作区已重建
          </p>
        )}
      </div>
    </div>
  );
}
