import { Hono } from 'hono';

import { authMiddleware, systemConfigMiddleware } from '../middleware/auth.js';
import type { RemoteAccessKernel } from '../remote-access-kernel/kernel.js';
import {
  ensureProviderExecutableAvailable,
  isExecutableAvailable,
} from '../remote-access-kernel/provider-availability.js';
import type {
  AccessLinkRequest,
  TunnelProviderKind,
  TunnelStartRequest,
} from '../remote-access-kernel/types.js';
import type { Variables } from '../web-context.js';

const remoteAccessRoutes = new Hono<{ Variables: Variables }>();

interface RemoteAccessRouteDeps {
  kernel: RemoteAccessKernel;
  enabled: boolean;
  defaultTargetUrl: string;
  providerCommands: {
    cloudflared: string;
    ngrok: string;
  };
  autoInstallProviders?: boolean;
}

let deps: RemoteAccessRouteDeps | null = null;

export function injectRemoteAccessDeps(next: RemoteAccessRouteDeps): void {
  deps = next;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPublicEntryErrorHtml(options: {
  title: string;
  message: string;
  reason?: string;
}): string {
  const title = escapeHtml(options.title);
  const message = escapeHtml(options.message);
  const reasonLine = options.reason
    ? `<p class="reason">Reason: <code>${escapeHtml(options.reason)}</code></p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f8fafc; color: #0f172a; display: grid; place-items: center; min-height: 100vh; }
    .card { width: min(560px, calc(100vw - 32px)); background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #334155; line-height: 1.55; }
    .reason { margin-top: 10px; color: #64748b; font-size: 13px; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 6px; }
    .brand { margin-bottom: 14px; font-size: 12px; font-weight: 600; color: #64748b; letter-spacing: 0.06em; text-transform: uppercase; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">SoloMesh Remote Access</div>
    <h1>${title}</h1>
    <p>${message}</p>
    ${reasonLine}
  </main>
</body>
</html>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStringMap(value: unknown): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (typeof v !== 'string') {
      return undefined;
    }
    out[key] = v;
  }
  return out;
}

function parseTunnelProviderKind(value: unknown): TunnelProviderKind | null {
  if (value === 'cloudflared') return 'cloudflared';
  if (value === 'ngrok') return 'ngrok';
  if (value === 'tunwg') return 'tunwg';
  if (value === 'custom') return 'custom';
  return null;
}

function parseStartTunnelRequest(
  value: unknown,
  defaultTargetUrl: string,
): TunnelStartRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  const provider = value.provider === undefined
    ? 'cloudflared'
    : parseTunnelProviderKind(value.provider);
  if (!provider) {
    return null;
  }

  const targetUrl = typeof value.targetUrl === 'string' && value.targetUrl.trim().length > 0
    ? value.targetUrl.trim()
    : defaultTargetUrl;
  if (!targetUrl) {
    return null;
  }

  const metadata = parseStringMap(value.metadata);
  if (value.metadata !== undefined && !metadata) {
    return null;
  }

  if (value.autoRestart !== undefined && typeof value.autoRestart !== 'boolean') {
    return null;
  }

  return {
    provider,
    targetUrl,
    autoRestart: value.autoRestart as boolean | undefined,
    metadata,
  };
}

function parseAccessLinkRequest(value: unknown): AccessLinkRequest | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.ttlSeconds !== 'number' || !Number.isFinite(value.ttlSeconds)) {
    return null;
  }
  const ttlSeconds = Math.floor(value.ttlSeconds);
  if (ttlSeconds <= 0 || ttlSeconds > 7 * 24 * 60 * 60) {
    return null;
  }

  if (value.oneTime !== undefined && typeof value.oneTime !== 'boolean') {
    return null;
  }
  if (value.path !== undefined && typeof value.path !== 'string') {
    return null;
  }
  const extraQuery = parseStringMap(value.extraQuery);
  if (value.extraQuery !== undefined && !extraQuery) {
    return null;
  }

  return {
    ttlSeconds,
    oneTime: value.oneTime as boolean | undefined,
    path: value.path as string | undefined,
    extraQuery,
  };
}

function parseTokenRequest(value: unknown): string | null {
  if (!isRecord(value) || typeof value.token !== 'string') {
    return null;
  }
  const token = value.token.trim();
  if (!token) {
    return null;
  }
  return token;
}

function parseTokenIdRequest(value: unknown): string | null {
  if (!isRecord(value) || typeof value.tokenId !== 'string') {
    return null;
  }
  const tokenId = value.tokenId.trim();
  if (!tokenId) {
    return null;
  }
  return tokenId;
}

function parseVerifyRequest(
  value: unknown,
): { token: string; consumeOneTime?: boolean } | null {
  const token = parseTokenRequest(value);
  if (!token || !isRecord(value)) {
    return null;
  }
  if (
    value.consumeOneTime !== undefined
    && typeof value.consumeOneTime !== 'boolean'
  ) {
    return null;
  }
  return {
    token,
    consumeOneTime: value.consumeOneTime as boolean | undefined,
  };
}

function resolveDeps(): RemoteAccessRouteDeps | null {
  if (!deps || !deps.enabled) {
    return null;
  }
  return deps;
}

function sanitizeRedirectPath(raw: string | undefined): string {
  const input = (raw || '/').trim();
  if (!input) {
    return '/';
  }
  try {
    const parsed = new URL(input, 'http://solomesh.local');
    if (parsed.origin !== 'http://solomesh.local') {
      return '/';
    }
    parsed.searchParams.delete('token');
    const query = parsed.searchParams.toString();
    return query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch {
    return '/';
  }
}

async function getProviderAvailability(
  resolved: RemoteAccessRouteDeps,
  options?: {
    autoInstall?: boolean;
    requestedProvider?: TunnelProviderKind;
  },
): Promise<Array<{
  kind: 'cloudflared' | 'ngrok';
  executable: string;
  available: boolean;
}>> {
  const autoInstall = options?.autoInstall ?? (resolved.autoInstallProviders ?? true);
  const cloudflaredExecutable = resolved.providerCommands.cloudflared;
  const ngrokExecutable = resolved.providerCommands.ngrok;

  const checks: Array<Promise<{
    kind: 'cloudflared' | 'ngrok';
    executable: string;
    available: boolean;
  }>> = [];

  if (!options?.requestedProvider || options.requestedProvider === 'cloudflared') {
    checks.push(
      ensureProviderExecutableAvailable('cloudflared', cloudflaredExecutable, {
        autoInstall,
        checkExecutable: isExecutableAvailable,
      }).then((available) => ({
        kind: 'cloudflared',
        executable: cloudflaredExecutable,
        available,
      })),
    );
  }

  if (!options?.requestedProvider || options.requestedProvider === 'ngrok') {
    checks.push(
      ensureProviderExecutableAvailable('ngrok', ngrokExecutable, {
        autoInstall,
        checkExecutable: isExecutableAvailable,
      }).then((available) => ({
        kind: 'ngrok',
        executable: ngrokExecutable,
        available,
      })),
    );
  }

  return Promise.all(checks);
}

remoteAccessRoutes.get('/public/entry', async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.html(
      renderPublicEntryErrorHtml({
        title: 'Remote access disabled',
        message: 'This endpoint is disabled by server configuration.',
      }),
      503,
    );
  }
  const token = (c.req.query('token') || '').trim();
  if (!token) {
    return c.html(
      renderPublicEntryErrorHtml({
        title: 'Missing token',
        message: 'Access token is required to open this link.',
      }),
      400,
    );
  }

  const verify = await resolved.kernel.verifyAccessToken(token, {
    consumeOneTime: true,
  });
  if (!verify.valid) {
    return c.html(
      renderPublicEntryErrorHtml({
        title: 'Invalid token',
        message: 'This access link is invalid or expired.',
        reason: verify.reason,
      }),
      401,
    );
  }

  const redirectPath = sanitizeRedirectPath(c.req.query('path'));
  return c.redirect(redirectPath, 302);
});

remoteAccessRoutes.get('/status', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const tunnel = await resolved.kernel.getTunnelStatus();
  const providers = await getProviderAvailability(resolved, { autoInstall: false });
  return c.json({
    enabled: true,
    defaultTargetUrl: resolved.defaultTargetUrl,
    tunnel,
    providers,
  });
});

remoteAccessRoutes.post('/tunnel/start', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const body = await c.req.json().catch(() => ({}));
  const request = parseStartTunnelRequest(body, resolved.defaultTargetUrl);
  if (!request) {
    return c.json({ error: 'Invalid request body.' }, 400);
  }
  if (request.provider === 'cloudflared' || request.provider === 'ngrok') {
    const [availability] = await getProviderAvailability(resolved, {
      requestedProvider: request.provider,
    });
    if (availability && !availability.available) {
      return c.json(
        {
          error: `Provider "${request.provider}" executable not found: ${availability.executable}`,
        },
        409,
      );
    }
  }
  try {
    const tunnel = await resolved.kernel.startTunnel(request);
    return c.json({ success: true, tunnel });
  } catch (error) {
    return c.json({ error: toErrorMessage(error) }, 500);
  }
});

remoteAccessRoutes.post('/tunnel/stop', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  try {
    const tunnel = await resolved.kernel.stopTunnel();
    return c.json({ success: true, tunnel });
  } catch (error) {
    return c.json({ error: toErrorMessage(error) }, 500);
  }
});

remoteAccessRoutes.post('/links', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const body = await c.req.json().catch(() => null);
  const request = parseAccessLinkRequest(body);
  if (!request) {
    return c.json({ error: 'Invalid request body.' }, 400);
  }
  try {
    const link = await resolved.kernel.createAccessLink(request);
    return c.json({ success: true, link });
  } catch (error) {
    const message = toErrorMessage(error);
    const status = message.includes('Tunnel is not running') ? 409 : 500;
    return c.json({ error: message }, status);
  }
});

remoteAccessRoutes.post('/tokens/verify', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const body = await c.req.json().catch(() => null);
  const request = parseVerifyRequest(body);
  if (!request) {
    return c.json({ error: 'Invalid request body.' }, 400);
  }
  const result = await resolved.kernel.verifyAccessToken(request.token, {
    consumeOneTime: request.consumeOneTime,
  });
  return c.json({ success: true, result });
});

remoteAccessRoutes.get('/tokens', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const tokens = await resolved.kernel.listAccessTokens();
  return c.json({ success: true, tokens });
});

remoteAccessRoutes.post('/tokens/revoke', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const body = await c.req.json().catch(() => null);
  const token = parseTokenRequest(body);
  if (!token) {
    return c.json({ error: 'Invalid request body.' }, 400);
  }
  const revoked = await resolved.kernel.revokeAccessToken(token);
  return c.json({ success: true, revoked });
});

remoteAccessRoutes.post('/tokens/revoke-by-id', authMiddleware, systemConfigMiddleware, async (c) => {
  const resolved = resolveDeps();
  if (!resolved) {
    return c.json({ error: 'Remote access is disabled.' }, 503);
  }
  const body = await c.req.json().catch(() => null);
  const tokenId = parseTokenIdRequest(body);
  if (!tokenId) {
    return c.json({ error: 'Invalid request body.' }, 400);
  }
  const revoked = await resolved.kernel.revokeAccessTokenById(tokenId);
  return c.json({ success: true, revoked });
});

export default remoteAccessRoutes;
