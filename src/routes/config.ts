// Configuration management routes

import { randomBytes, createHash } from 'node:crypto';
import { Hono } from 'hono';
import { canAccessGroup, type Variables, type WebDeps } from '../web-context.js';
import { authMiddleware, systemConfigMiddleware } from '../middleware/auth.js';
import {
  getAgentProviderConfiguredMap,
  listAgentProviderDefinitions,
} from '../agent-providers.js';
import {
  RuntimeConfigSchema,
  RuntimeSecretsSchema,
  RuntimeCustomEnvSchema,
  ChannelSessionBindingUpsertSchema,
  RegistrationConfigSchema,
  AppearanceConfigSchema,
} from '../schemas.js';
import {
  deleteChannelSessionBinding,
  getAllChats,
  getAllRegisteredGroups,
  getChannelSessionBinding,
  getRegisteredGroup,
  getUserHomeGroup,
  listChannelSessionBindings,
  parseImChannelFromJid,
  setRegisteredGroup,
  upsertChannelSessionBinding,
} from '../db.js';
import { listImChannelDefinitions } from '../im-channel.js';
import {
  reloadGlobalImChannelBestEffort,
  reloadUserImChannelBestEffort,
} from '../im-channel-config-reload.js';
import { listImChannelConfigDescriptors } from '../im-channel-config-descriptor.js';
import {
  getRuntimeProviderConfig,
  toPublicRuntimeProviderConfig,
  saveRuntimeProviderConfig,
  appendRuntimeConfigAudit,
  getGlobalRuntimeCustomEnv,
  saveGlobalRuntimeCustomEnv,
  getRegistrationConfig,
  saveRegistrationConfig,
  getAppearanceConfig,
  saveAppearanceConfig,
  updateAllSessionCredentials,
} from '../runtime-config.js';
import type {
  RuntimeOAuthCredentials,
  FeishuProviderPublicConfig,
  TelegramProviderPublicConfig,
} from '../runtime-config.js';
import type { AuthUser, ImChannel, RegisteredGroup } from '../types.js';
import { hasPermission } from '../permissions.js';
import { logger } from '../logger.js';

const configRoutes = new Hono<{ Variables: Variables }>();

type ConfigRouteDeps = Pick<
  WebDeps,
  | 'queue'
  | 'getRegisteredGroups'
  | 'reloadGlobalIMConfig'
  | 'reloadUserIMConfig'
  | 'getImChannelStatus'
  | 'getUserImChannelStatus'
>;

// Inject deps at runtime
let deps: ConfigRouteDeps | null = null;
export function injectConfigDeps(d: ConfigRouteDeps) {
  deps = d;
}

interface UserImWorkspaceOption {
  folder: string;
  name: string;
  is_home: boolean;
}

interface UserImSessionBindingView {
  targetFolder: string;
  enabled: boolean;
  ownerUserId: string;
  updatedAt: string;
}

interface UserImSessionView {
  chatJid: string;
  channel: ImChannel;
  name: string;
  lastActivity: string;
  mappedFolder: string | null;
  mappedWorkspaceName: string | null;
  binding: UserImSessionBindingView | null;
}

interface UserImChannelStatusView {
  id: ImChannel;
  displayName: string;
  connected: boolean;
}

function canManageImSession(
  user: AuthUser,
  group: (ReturnType<typeof getRegisteredGroup>) | undefined,
): boolean {
  if (user.role === 'admin') return true;
  if (!group) return false;
  return group.created_by === user.id;
}

function listAccessibleWorkspaceOptions(user: AuthUser): UserImWorkspaceOption[] {
  const groups = getAllRegisteredGroups();
  const byFolder = new Map<string, UserImWorkspaceOption>();

  for (const [jid, group] of Object.entries(groups)) {
    if (!jid.startsWith('web:')) continue;
    if (!canAccessGroup({ id: user.id, role: user.role }, { ...group, jid })) {
      continue;
    }
    if (!byFolder.has(group.folder)) {
      byFolder.set(group.folder, {
        folder: group.folder,
        name: group.name,
        is_home: !!group.is_home,
      });
    }
  }

  return Array.from(byFolder.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-Hans-CN'),
  );
}

function listWorkspaceNameByFolder(): Map<string, string> {
  const groups = getAllRegisteredGroups();
  const byFolder = new Map<string, string>();
  for (const [jid, group] of Object.entries(groups)) {
    if (!jid.startsWith('web:')) continue;
    if (!byFolder.has(group.folder)) {
      byFolder.set(group.folder, group.name);
    }
  }
  return byFolder;
}

function syncRegisteredGroupCache(
  chatJid: string,
  group: RegisteredGroup & { jid?: string },
): void {
  try {
    const cache = deps?.getRegisteredGroups?.();
    if (!cache || typeof cache !== 'object') return;
    const { jid: _jid, ...nextGroup } = group;
    cache[chatJid] = nextGroup;
  } catch {
    // best effort
  }
}

async function stopGroupProcessBestEffort(chatJid: string): Promise<void> {
  if (!deps?.queue?.stopGroup) return;
  try {
    await deps.queue.stopGroup(chatJid);
  } catch (err) {
    logger.warn({ err, chatJid }, 'Failed to stop group process after IM binding update');
  }
}

function buildUserImChannelStatus(
  statusMap?: Partial<Record<ImChannel, boolean>>,
): UserImChannelStatusView[] {
  return listImChannelDefinitions().map((def) => ({
    id: def.id,
    displayName: def.displayName,
    connected: statusMap?.[def.id] === true,
  }));
}

function isSystemChannelConfigConnectable(
  channel: ImChannel,
  config: FeishuProviderPublicConfig | TelegramProviderPublicConfig,
): boolean {
  const enabled = config.enabled;
  if (!enabled) return false;

  if (channel === 'feishu') {
    const appId =
      'appId' in config && typeof config.appId === 'string'
        ? config.appId.trim()
        : '';
    const hasAppSecret = 'hasAppSecret' in config && config.hasAppSecret;
    return !!appId && hasAppSecret;
  }

  const hasBotToken = 'hasBotToken' in config && config.hasBotToken;
  return hasBotToken;
}

// --- Routes ---

configRoutes.get('/runtimes', authMiddleware, systemConfigMiddleware, (c) => {
  try {
    const current = getRuntimeProviderConfig();
    return c.json({
      runtimes: listAgentProviderDefinitions(),
      activeRuntime: current.agentRuntime,
      configuredRuntimes: getAgentProviderConfiguredMap(current),
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load agent provider definitions');
    return c.json({ error: 'Failed to load agent runtimes' }, 500);
  }
});

const getProviderConfigHandler = (c: any) => {
  try {
    return c.json(toPublicRuntimeProviderConfig(getRuntimeProviderConfig()));
  } catch (err) {
    logger.error({ err }, 'Failed to load runtime config');
    return c.json({ error: 'Failed to load runtime config' }, 500);
  }
};

const getProviderCustomEnvHandler = (c: any) => {
  try {
    const user = c.get('user') as AuthUser;
    const customEnv = getGlobalRuntimeCustomEnv();
    if (!hasPermission(user, 'manage_system_config')) {
      return c.json({ customEnv: {} });
    }
    return c.json({ customEnv });
  } catch (err) {
    logger.error({ err }, 'Failed to load runtime custom env');
    return c.json({ error: 'Failed to load runtime custom env' }, 500);
  }
};

const putProviderConfigHandler = async (c: any) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RuntimeConfigSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const actor = (c.get('user') as AuthUser).username;
  const current = getRuntimeProviderConfig();

  try {
    const next = { ...current };
    const changedFields: string[] = [];

    if (typeof validation.data.agentRuntime === 'string') {
      next.agentRuntime = validation.data.agentRuntime;
      changedFields.push('agentRuntime');
    }
    if (typeof validation.data.anthropicBaseUrl === 'string') {
      next.anthropicBaseUrl = validation.data.anthropicBaseUrl;
      changedFields.push('anthropicBaseUrl');
    }
    if (typeof validation.data.codexBaseUrl === 'string') {
      next.codexBaseUrl = validation.data.codexBaseUrl;
      changedFields.push('codexBaseUrl');
    }
    if (typeof validation.data.codexModel === 'string') {
      next.codexModel = validation.data.codexModel;
      changedFields.push('codexModel');
    }

    if (changedFields.length === 0) {
      return c.json({ error: 'No config changes provided' }, 400);
    }

    const saved = saveRuntimeProviderConfig({
      agentRuntime: next.agentRuntime,
      anthropicBaseUrl: next.anthropicBaseUrl,
      codexBaseUrl: next.codexBaseUrl,
      codexModel: next.codexModel,
      anthropicAuthToken: next.anthropicAuthToken,
      anthropicApiKey: next.anthropicApiKey,
      claudeCodeOauthToken: next.claudeCodeOauthToken,
      codexApiKey: next.codexApiKey,
      claudeOAuthCredentials: next.claudeOAuthCredentials,
    });
    appendRuntimeConfigAudit(actor, 'update_config', changedFields);
    return c.json(toPublicRuntimeProviderConfig(saved));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid runtime config payload';
    logger.warn({ err }, 'Invalid runtime config payload');
    return c.json({ error: message }, 400);
  }
};

const putProviderCustomEnvHandler = async (c: any) => {
  const body = await c.req.json().catch(() => ({}));
  const validation = RuntimeCustomEnvSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  try {
    const saved = saveGlobalRuntimeCustomEnv(validation.data.customEnv);
    return c.json({ customEnv: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid custom env payload';
    logger.warn({ err }, 'Invalid runtime custom env payload');
    return c.json({ error: message }, 400);
  }
};

const putProviderSecretsHandler = async (c: any) => {
  const body = await c.req.json().catch(() => ({}));

  const validation = RuntimeSecretsSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const actor = (c.get('user') as AuthUser).username;
  const current = getRuntimeProviderConfig();

  const next = { ...current };
  const changedFields: string[] = [];

  if (typeof validation.data.anthropicAuthToken === 'string') {
    next.anthropicAuthToken = validation.data.anthropicAuthToken;
    changedFields.push('anthropicAuthToken:set');
  } else if (validation.data.clearAnthropicAuthToken === true) {
    next.anthropicAuthToken = '';
    changedFields.push('anthropicAuthToken:clear');
  }

  if (typeof validation.data.anthropicApiKey === 'string') {
    next.anthropicApiKey = validation.data.anthropicApiKey;
    changedFields.push('anthropicApiKey:set');
  } else if (validation.data.clearAnthropicApiKey === true) {
    next.anthropicApiKey = '';
    changedFields.push('anthropicApiKey:clear');
  }

  if (typeof validation.data.claudeCodeOauthToken === 'string') {
    next.claudeCodeOauthToken = validation.data.claudeCodeOauthToken;
    changedFields.push('claudeCodeOauthToken:set');
  } else if (validation.data.clearClaudeCodeOauthToken === true) {
    next.claudeCodeOauthToken = '';
    changedFields.push('claudeCodeOauthToken:clear');
  }

  if (typeof validation.data.codexApiKey === 'string') {
    next.codexApiKey = validation.data.codexApiKey;
    changedFields.push('codexApiKey:set');
  } else if (validation.data.clearCodexApiKey === true) {
    next.codexApiKey = '';
    changedFields.push('codexApiKey:clear');
  }

  if (validation.data.claudeOAuthCredentials) {
    next.claudeOAuthCredentials = validation.data.claudeOAuthCredentials;
    // When setting full credentials, clear the single-token field
    next.claudeCodeOauthToken = '';
    changedFields.push('claudeOAuthCredentials:set');
  } else if (validation.data.clearRuntimeOAuthCredentials === true) {
    next.claudeOAuthCredentials = null;
    changedFields.push('claudeOAuthCredentials:clear');
  }

  if (changedFields.length === 0) {
    return c.json({ error: 'No secret changes provided' }, 400);
  }

  try {
    const saved = saveRuntimeProviderConfig({
      agentRuntime: next.agentRuntime,
      anthropicBaseUrl: next.anthropicBaseUrl,
      codexBaseUrl: next.codexBaseUrl,
      codexModel: next.codexModel,
      anthropicAuthToken: next.anthropicAuthToken,
      anthropicApiKey: next.anthropicApiKey,
      claudeCodeOauthToken: next.claudeCodeOauthToken,
      codexApiKey: next.codexApiKey,
      claudeOAuthCredentials: next.claudeOAuthCredentials,
    });

    // Update .credentials.json in all session directories when credentials change
    if (validation.data.claudeOAuthCredentials) {
      updateAllSessionCredentials(saved);
    }

    appendRuntimeConfigAudit(actor, 'update_secrets', changedFields);
    return c.json(toPublicRuntimeProviderConfig(saved));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid runtime config payload';
    logger.warn({ err }, 'Invalid runtime secret payload');
    return c.json({ error: message }, 400);
  }
};

const postProviderApplyHandler = async (c: any) => {
  const localDeps = deps;
  if (!localDeps) return c.json({ error: 'Server not initialized' }, 500);

  const actor = (c.get('user') as AuthUser).username;
  const groupJids = Object.keys(localDeps.getRegisteredGroups());
  const results = await Promise.allSettled(
    groupJids.map((jid) => localDeps.queue.stopGroup(jid)),
  );
  const failedCount = results.filter((r) => r.status === 'rejected').length;
  appendRuntimeConfigAudit(actor, 'apply_to_all_flows', ['queue.stopGroup'], {
    stoppedCount: groupJids.length - failedCount,
    failedCount,
  });
  if (failedCount > 0) {
    return c.json(
      {
        success: false,
        stoppedCount: groupJids.length - failedCount,
        failedCount,
        error: `${failedCount} container(s) failed to stop`,
      },
      207,
    );
  }
  return c.json({ success: true, stoppedCount: groupJids.length });
};

configRoutes.get('/runtime', authMiddleware, systemConfigMiddleware, getProviderConfigHandler);

configRoutes.get(
  '/runtime/custom-env',
  authMiddleware,
  systemConfigMiddleware,
  getProviderCustomEnvHandler,
);

configRoutes.put('/runtime', authMiddleware, systemConfigMiddleware, putProviderConfigHandler);

configRoutes.put(
  '/runtime/custom-env',
  authMiddleware,
  systemConfigMiddleware,
  putProviderCustomEnvHandler,
);

configRoutes.put(
  '/runtime/secrets',
  authMiddleware,
  systemConfigMiddleware,
  putProviderSecretsHandler,
);

configRoutes.post(
  '/runtime/apply',
  authMiddleware,
  systemConfigMiddleware,
  postProviderApplyHandler,
);

// ─── Claude OAuth (PKCE) ─────────────────────────────────────────

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_FLOW_TTL = 10 * 60 * 1000; // 10 minutes

interface OAuthFlow {
  codeVerifier: string;
  expiresAt: number;
}
const oauthFlows = new Map<string, OAuthFlow>();

// Periodic cleanup of expired flows
setInterval(() => {
  const now = Date.now();
  for (const [key, flow] of oauthFlows) {
    if (flow.expiresAt < now) oauthFlows.delete(key);
  }
}, 60_000);

configRoutes.post(
  '/runtime/oauth/start',
  authMiddleware,
  systemConfigMiddleware,
  (c) => {
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    oauthFlows.set(state, {
      codeVerifier,
      expiresAt: Date.now() + OAUTH_FLOW_TTL,
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return c.json({ authorizeUrl: `${OAUTH_AUTHORIZE_URL}?${params.toString()}`, state });
  },
);

configRoutes.post(
  '/runtime/oauth/callback',
  authMiddleware,
  systemConfigMiddleware,
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { state, code } = body as { state?: string; code?: string };

    if (!state || !code) {
      return c.json({ error: 'Missing state or code' }, 400);
    }

    // Clean up code: strip URL fragments and query params that users may accidentally copy
    const cleanedCode = code.trim().split('#')[0]?.split('&')[0] ?? code.trim();

    const flow = oauthFlows.get(state);
    if (!flow) {
      return c.json({ error: 'Invalid or expired OAuth state' }, 400);
    }
    if (flow.expiresAt < Date.now()) {
      oauthFlows.delete(state);
      return c.json({ error: 'OAuth flow expired' }, 400);
    }
    oauthFlows.delete(state);

    try {
      const tokenResp = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://claude.ai/',
          'Origin': 'https://claude.ai',
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: OAUTH_CLIENT_ID,
          code: cleanedCode,
          redirect_uri: OAUTH_REDIRECT_URI,
          code_verifier: flow.codeVerifier,
          state,
        }),
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text().catch(() => '');
        logger.warn({ status: tokenResp.status, body: errText }, 'OAuth token exchange failed');
        return c.json({ error: `Token exchange failed: ${tokenResp.status}` }, 400);
      }

      const tokenData = (await tokenResp.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        [key: string]: unknown;
      };

      if (!tokenData.access_token) {
        return c.json({ error: 'No access_token in response' }, 400);
      }

      const actor = (c.get('user') as AuthUser).username;
      const current = getRuntimeProviderConfig();

      // Build full OAuth credentials when refresh_token is available
      let oauthCredentials: RuntimeOAuthCredentials | null = null;
      if (tokenData.refresh_token) {
        // expiresAt 计算与 SDK 保持一致：Date.now() + expires_in * 1000
        const expiresAt = tokenData.expires_in
          ? Date.now() + tokenData.expires_in * 1000
          : Date.now() + 8 * 60 * 60 * 1000; // default 8h
        oauthCredentials = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          expiresAt,
          scopes: tokenData.scope ? tokenData.scope.split(' ') : [],
        };
      }

      const saved = saveRuntimeProviderConfig({
        agentRuntime: 'claude',
        anthropicBaseUrl: current.anthropicBaseUrl,
        codexBaseUrl: current.codexBaseUrl,
        codexModel: current.codexModel,
        anthropicAuthToken: '',
        anthropicApiKey: '',
        // When we have full credentials, clear the single-token field
        claudeCodeOauthToken: oauthCredentials ? '' : tokenData.access_token,
        codexApiKey: current.codexApiKey,
        claudeOAuthCredentials: oauthCredentials,
      });

      // Write .credentials.json to all session directories
      if (oauthCredentials) {
        updateAllSessionCredentials(saved);
      }

      appendRuntimeConfigAudit(actor, 'oauth_login', [
        oauthCredentials ? 'claudeOAuthCredentials:set' : 'claudeCodeOauthToken:set',
        'anthropicAuthToken:clear',
        'anthropicApiKey:clear',
      ]);

      return c.json(toPublicRuntimeProviderConfig(saved));
    } catch (err) {
      logger.error({ err }, 'OAuth token exchange error');
      const message = err instanceof Error ? err.message : 'OAuth token exchange failed';
      return c.json({ error: message }, 500);
    }
  },
);

for (const descriptor of listImChannelConfigDescriptors()) {
  configRoutes.get(
    `/${descriptor.routeSegment}`,
    authMiddleware,
    systemConfigMiddleware,
    (c) => {
      try {
        const { config, source } = descriptor.getSystemConfigWithSource();
        const pub = descriptor.toPublicSystemConfig(config, source);
        const anyUserConnected =
          deps?.getImChannelStatus?.()[descriptor.channel] ?? false;
        const connected =
          isSystemChannelConfigConnectable(
            descriptor.channel,
            pub,
          ) && anyUserConnected;
        return c.json({ ...pub, connected });
      } catch (err) {
        logger.error({ err }, descriptor.loadSystemErrorMessage);
        return c.json({ error: descriptor.loadSystemErrorMessage }, 500);
      }
    },
  );

  configRoutes.put(
    `/${descriptor.routeSegment}`,
    authMiddleware,
    systemConfigMiddleware,
    async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const validation = descriptor.schema.safeParse(body);
      if (!validation.success) {
        return c.json(
          { error: 'Invalid request body', details: validation.error.format() },
          400,
        );
      }

      const next = descriptor.mergeSystemConfig(
        descriptor.getSystemConfig(),
        validation.data,
      );

      try {
        const saved = descriptor.saveSystemConfig(next);
        const connected = await reloadGlobalImChannelBestEffort(
          deps,
          descriptor.channel,
          saved,
        );
        return c.json({
          ...descriptor.toPublicSystemConfig(saved, 'runtime'),
          connected,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : descriptor.invalidSystemPayloadMessage;
        logger.warn({ err }, descriptor.invalidSystemPayloadMessage);
        return c.json({ error: message }, 400);
      }
    },
  );
}

for (const descriptor of listImChannelConfigDescriptors()) {
  if (!descriptor.systemConnectionTest) continue;
  configRoutes.post(
    `/${descriptor.routeSegment}/test`,
    authMiddleware,
    systemConfigMiddleware,
    async (c) => {
      const result = await descriptor.systemConnectionTest!();
      return c.json(result.payload, result.status);
    },
  );
}

// ─── Registration config ─────────────────────────────────────────

configRoutes.get(
  '/registration',
  authMiddleware,
  systemConfigMiddleware,
  (c) => {
    try {
      return c.json(getRegistrationConfig());
    } catch (err) {
      logger.error({ err }, 'Failed to load registration config');
      return c.json({ error: 'Failed to load registration config' }, 500);
    }
  },
);

configRoutes.put(
  '/registration',
  authMiddleware,
  systemConfigMiddleware,
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const validation = RegistrationConfigSchema.safeParse(body);
    if (!validation.success) {
      return c.json(
        { error: 'Invalid request body', details: validation.error.format() },
        400,
      );
    }

    try {
      const actor = (c.get('user') as AuthUser).username;
      const saved = saveRegistrationConfig(validation.data);
      appendRuntimeConfigAudit(actor, 'update_registration_config', [
        'allowRegistration',
        'requireInviteCode',
      ]);
      return c.json(saved);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Invalid registration config payload';
      logger.warn({ err }, 'Invalid registration config payload');
      return c.json({ error: message }, 400);
    }
  },
);

// ─── Appearance config ────────────────────────────────────────────

configRoutes.get(
  '/appearance',
  authMiddleware,
  systemConfigMiddleware,
  (c) => {
    try {
      return c.json(getAppearanceConfig());
    } catch (err) {
      logger.error({ err }, 'Failed to load appearance config');
      return c.json({ error: 'Failed to load appearance config' }, 500);
    }
  },
);

configRoutes.put(
  '/appearance',
  authMiddleware,
  systemConfigMiddleware,
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const validation = AppearanceConfigSchema.safeParse(body);
    if (!validation.success) {
      return c.json(
        { error: 'Invalid request body', details: validation.error.format() },
        400,
      );
    }

    try {
      const saved = saveAppearanceConfig(validation.data);
      return c.json(saved);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Invalid appearance config payload';
      logger.warn({ err }, 'Invalid appearance config payload');
      return c.json({ error: message }, 400);
    }
  },
);

// Public endpoint — no auth required (like /api/auth/status)
configRoutes.get('/appearance/public', (c) => {
  try {
    const config = getAppearanceConfig();
    return c.json({
      appName: config.appName,
      aiName: config.aiName,
      aiAvatarEmoji: config.aiAvatarEmoji,
      aiAvatarColor: config.aiAvatarColor,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load public appearance config');
    return c.json({ error: 'Failed to load appearance config' }, 500);
  }
});

// ─── Per-user IM connection status ──────────────────────────────────

configRoutes.get('/user-im/status', authMiddleware, (c) => {
  const user = c.get('user') as AuthUser;
  const statusMap = deps?.getUserImChannelStatus?.(user.id);
  return c.json({
    channels: buildUserImChannelStatus(statusMap),
  });
});

configRoutes.get('/user-im/sessions', authMiddleware, (c) => {
  const user = c.get('user') as AuthUser;
  const workspaceOptions = listAccessibleWorkspaceOptions(user);
  const workspaceNameByFolder = listWorkspaceNameByFolder();
  const sessions: UserImSessionView[] = [];

  const bindings = listChannelSessionBindings(
    user.role === 'admin' ? {} : { ownerUserId: user.id },
  );
  const bindingByJid = new Map(bindings.map((item) => [item.chat_jid, item]));

  const chats = getAllChats();
  for (const chat of chats) {
    const channel = parseImChannelFromJid(chat.jid);
    if (!channel) continue;

    const group = getRegisteredGroup(chat.jid);
    if (!canManageImSession(user, group)) continue;
    if (group && !canAccessGroup({ id: user.id, role: user.role }, group)) {
      continue;
    }

    const binding = bindingByJid.get(chat.jid) ?? getChannelSessionBinding(chat.jid);
    const mappedFolder = group?.folder ?? null;
    sessions.push({
      chatJid: chat.jid,
      channel,
      name: chat.name || chat.jid,
      lastActivity: chat.last_message_time,
      mappedFolder,
      mappedWorkspaceName: mappedFolder ? (workspaceNameByFolder.get(mappedFolder) || null) : null,
      binding: binding
        ? {
            targetFolder: binding.target_folder,
            enabled: binding.enabled,
            ownerUserId: binding.owner_user_id,
            updatedAt: binding.updated_at,
          }
        : null,
    });
  }

  return c.json({
    sessions,
    workspaces: workspaceOptions,
  });
});

configRoutes.put('/user-im/bindings', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const body = await c.req.json().catch(() => ({}));
  const validation = ChannelSessionBindingUpsertSchema.safeParse(body);
  if (!validation.success) {
    return c.json(
      { error: 'Invalid request body', details: validation.error.format() },
      400,
    );
  }

  const chatJid = validation.data.chatJid.trim();
  const targetFolder = validation.data.targetFolder.trim();
  const channel = parseImChannelFromJid(chatJid);
  if (!channel) {
    return c.json({ error: 'chatJid must be a supported IM session' }, 400);
  }

  const sessionGroup = getRegisteredGroup(chatJid);
  if (!sessionGroup) {
    return c.json({ error: 'IM session not found. Send one message from channel first.' }, 404);
  }
  if (!canManageImSession(user, sessionGroup)) {
    return c.json({ error: 'No permission to manage this IM session' }, 403);
  }
  if (!canAccessGroup({ id: user.id, role: user.role }, sessionGroup)) {
    return c.json({ error: 'No permission to access this IM session' }, 403);
  }

  const workspace = listAccessibleWorkspaceOptions(user).find(
    (item) => item.folder === targetFolder,
  );
  if (!workspace) {
    return c.json({ error: 'Target workspace not found or inaccessible' }, 404);
  }

  const ownerUserId = (sessionGroup.created_by || user.id).trim();
  const binding = upsertChannelSessionBinding({
    chat_jid: chatJid,
    target_folder: targetFolder,
    owner_user_id: ownerUserId,
    enabled: validation.data.enabled,
    actor_user_id: user.id,
  });

  if (sessionGroup.folder !== targetFolder || sessionGroup.created_by !== ownerUserId) {
    const nextGroup = {
      ...sessionGroup,
      folder: targetFolder,
      created_by: ownerUserId,
    };
    setRegisteredGroup(chatJid, nextGroup);
    syncRegisteredGroupCache(chatJid, nextGroup);
    await stopGroupProcessBestEffort(chatJid);
    logger.info(
      { chatJid, channel, fromFolder: sessionGroup.folder, toFolder: targetFolder, ownerUserId, actor: user.id },
      'Updated IM session binding and remapped group folder',
    );
  } else {
    logger.info(
      { chatJid, channel, folder: targetFolder, ownerUserId, actor: user.id },
      'Updated IM session binding',
    );
  }

  return c.json({
    success: true,
    binding,
    mappedFolder: targetFolder,
  });
});

configRoutes.delete('/user-im/bindings/:chatJid', authMiddleware, async (c) => {
  const user = c.get('user') as AuthUser;
  const chatJid = decodeURIComponent(c.req.param('chatJid') || '').trim();
  const channel = parseImChannelFromJid(chatJid);
  if (!channel) {
    return c.json({ error: 'chatJid must be a supported IM session' }, 400);
  }

  const sessionGroup = getRegisteredGroup(chatJid);
  const binding = getChannelSessionBinding(chatJid);
  if (!sessionGroup && !binding) {
    return c.json({ error: 'IM session binding not found' }, 404);
  }
  if (!canManageImSession(user, sessionGroup)) {
    return c.json({ error: 'No permission to manage this IM session' }, 403);
  }

  deleteChannelSessionBinding(chatJid);

  let mappedFolder: string | null = sessionGroup?.folder ?? null;
  if (sessionGroup) {
    const ownerUserId = sessionGroup.created_by || binding?.owner_user_id || user.id;
    const ownerHome = getUserHomeGroup(ownerUserId);
    if (ownerHome && sessionGroup.folder !== ownerHome.folder) {
      const nextGroup = {
        ...sessionGroup,
        folder: ownerHome.folder,
      };
      setRegisteredGroup(chatJid, nextGroup);
      syncRegisteredGroupCache(chatJid, nextGroup);
      await stopGroupProcessBestEffort(chatJid);
      mappedFolder = ownerHome.folder;
      logger.info(
        { chatJid, channel, toFolder: ownerHome.folder, ownerUserId, actor: user.id },
        'Removed IM session binding and restored home folder mapping',
      );
    }
  }

  return c.json({
    success: true,
    chatJid,
    mappedFolder,
  });
});

// ─── Per-user IM config (all logged-in users) ─────────────────────

for (const descriptor of listImChannelConfigDescriptors()) {
  configRoutes.get(`/user-im/${descriptor.routeSegment}`, authMiddleware, (c) => {
    const user = c.get('user') as AuthUser;
    try {
      const config = descriptor.getUserConfig(user.id);
      if (!config) {
        return c.json(descriptor.emptyUserPublicConfig);
      }
      return c.json(descriptor.toPublicUserConfig(config));
    } catch (err) {
      logger.error({ err }, descriptor.loadUserErrorMessage);
      return c.json({ error: descriptor.loadUserErrorMessage }, 500);
    }
  });

  configRoutes.put(`/user-im/${descriptor.routeSegment}`, authMiddleware, async (c) => {
    const user = c.get('user') as AuthUser;
    const body = await c.req.json().catch(() => ({}));
    const validation = descriptor.schema.safeParse(body);
    if (!validation.success) {
      return c.json(
        { error: 'Invalid request body', details: validation.error.format() },
        400,
      );
    }

    const next = descriptor.mergeUserConfig(
      descriptor.getUserConfig(user.id),
      validation.data,
    );

    try {
      const saved = descriptor.saveUserConfig(user.id, next);
      await reloadUserImChannelBestEffort(deps, user.id, descriptor.channel);
      return c.json(descriptor.toPublicUserConfig(saved));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : descriptor.invalidUserPayloadMessage;
      logger.warn({ err }, descriptor.invalidUserPayloadLogMessage);
      return c.json({ error: message }, 400);
    }
  });
}

for (const descriptor of listImChannelConfigDescriptors()) {
  if (!descriptor.userConnectionTest) continue;
  configRoutes.post(`/user-im/${descriptor.routeSegment}/test`, authMiddleware, async (c) => {
    const user = c.get('user') as AuthUser;
    const result = await descriptor.userConnectionTest!(user.id);
    return c.json(result.payload, result.status);
  });
}

export default configRoutes;
