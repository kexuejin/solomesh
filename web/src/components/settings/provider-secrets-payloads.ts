export interface OAuthSecretsInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}

export function buildOfficialOauthSecretsPayload(
  credentials: OAuthSecretsInput,
): Record<string, unknown> {
  return {
    claudeOAuthCredentials: credentials,
    clearAnthropicAuthToken: true,
    clearAnthropicApiKey: true,
    clearClaudeCodeOauthToken: true,
  };
}

export function buildOfficialSetupTokenSecretsPayload(
  setupToken: string,
): Record<string, unknown> {
  return {
    claudeCodeOauthToken: setupToken,
    clearAnthropicAuthToken: true,
    clearAnthropicApiKey: true,
    clearRuntimeOAuthCredentials: true,
  };
}

export function buildThirdPartySecretsPayload(input: {
  authTokenDirty: boolean;
  authToken: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    clearClaudeCodeOauthToken: true,
    clearAnthropicApiKey: true,
    clearRuntimeOAuthCredentials: true,
  };
  if (input.authTokenDirty) {
    payload.anthropicAuthToken = input.authToken;
  }
  return payload;
}

export function buildCodexSecretsPayload(input: {
  codexApiKeyDirty: boolean;
  codexApiKey: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.codexApiKeyDirty) {
    payload.codexApiKey = input.codexApiKey;
  }
  return payload;
}

export function buildGeminiSecretsPayload(input: {
  geminiAuthMode: 'api_key';
  geminiApiKeyDirty: boolean;
  geminiApiKey: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (input.geminiApiKeyDirty) {
    payload.geminiApiKey = input.geminiApiKey;
  }
  return payload;
}

export function hasSecretPayloadChanges(
  payload: Record<string, unknown>,
): boolean {
  return Object.keys(payload).length > 0;
}
