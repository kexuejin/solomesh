const RUNTIME_CONFIG_BASE = '/api/config/runtime';

export function getRuntimeConfigEndpoint(): string {
  return RUNTIME_CONFIG_BASE;
}

export function getRuntimeCustomEnvEndpoint(): string {
  return `${RUNTIME_CONFIG_BASE}/custom-env`;
}

export function getRuntimeSecretsEndpoint(): string {
  return `${RUNTIME_CONFIG_BASE}/secrets`;
}

export function getRuntimeApplyEndpoint(): string {
  return `${RUNTIME_CONFIG_BASE}/apply`;
}
