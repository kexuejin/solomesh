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
      if (currentRuntime.capabilities.supportsCustomBaseUrl) {
        data.codexBaseUrl = codexBaseUrl;
      }
      if (currentRuntime.capabilities.supportsModelOverride) {
        data.codexModel = codexModel;
      }
      if (codexApiKeyDirty) data.codexApiKey = codexApiKey;
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
        {!usesAnthropicRuntime ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                CODEX_API_KEY
                {config?.hasCodexApiKey && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                    ({config.codexApiKeyMasked})
                  </span>
                )}
              </label>
              <Input
                type="password"
                value={codexApiKey}
                onChange={(e) => {
                  setCodexApiKey(e.target.value);
                  setCodexApiKeyDirty(true);
                }}
                placeholder={config?.hasCodexApiKey ? '已设置，输入新值覆盖；留空保持原值' : '留空使用全局配置'}
                className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
              />
            </div>
            {currentRuntime.capabilities.supportsCustomBaseUrl && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  OPENAI_BASE_URL
                </label>
                <Input
                  type="text"
                  value={codexBaseUrl}
                  onChange={(e) => setCodexBaseUrl(e.target.value)}
                  placeholder="留空使用全局配置"
                  className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                />
              </div>
            )}
            {currentRuntime.capabilities.supportsModelOverride && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  CODEX_MODEL
                </label>
                <Input
                  type="text"
                  value={codexModel}
                  onChange={(e) => setCodexModel(e.target.value)}
                  placeholder="留空使用全局配置"
                  className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {currentRuntime.capabilities.supportsThirdPartyGateway && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  ANTHROPIC_BASE_URL
                </label>
                <Input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="留空使用全局配置"
                  className="h-9 rounded-lg border-border/75 bg-card px-2.5 py-1.5 text-xs"
                />
              </div>
            )}

            <div>
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
              />
            </div>

          </div>
        )}

        {/* Separator */}
        <div className="border-t border-border/70" />

        {/* Custom Env Vars */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">自定义环境变量</label>
            <button
              onClick={addCustomEnv}
              className="flex items-center gap-1 text-[11px] text-primary hover:text-primary cursor-pointer"
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
        <Button onClick={handleSave} disabled={saving} className="w-full" size="sm">
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
