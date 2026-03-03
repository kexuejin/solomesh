import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web server mounts remote-access routes', () => {
  const web = read('src/web.ts');

  assert.ok(
    web.includes("import remoteAccessRoutes, { injectRemoteAccessDeps } from './routes/remote-access.js';"),
  );
  assert.ok(web.includes('NgrokTunnelProviderAdapter'));
  assert.ok(web.includes('new NgrokTunnelProviderAdapter({'));
  assert.ok(web.includes('providerCommands: {'));
  assert.ok(web.includes('cloudflared: CLOUDFLARED_BIN'));
  assert.ok(web.includes('ngrok: NGROK_BIN'));
  assert.ok(web.includes("app.route('/api/remote-access', remoteAccessRoutes);"));
  assert.ok(web.includes("app.get('/r/:code'"));
  assert.ok(web.includes('injectRemoteAccessDeps({'));
  assert.ok(web.includes('kernel: remoteAccessKernel'));
});

test('remote-access routes expose minimal tunnel and token endpoints', () => {
  const routes = read('src/routes/remote-access.ts');

  assert.ok(routes.includes("remoteAccessRoutes.get('/status'"));
  assert.ok(routes.includes("remoteAccessRoutes.get('/public/entry'"));
  assert.ok(routes.includes("remoteAccessRoutes.post('/tunnel/start'"));
  assert.ok(routes.includes("remoteAccessRoutes.post('/tunnel/stop'"));
  assert.ok(routes.includes("remoteAccessRoutes.post('/links'"));
  assert.ok(routes.includes("remoteAccessRoutes.put('/preferences'"));
  assert.ok(routes.includes("remoteAccessRoutes.post('/tokens/verify'"));
  assert.ok(routes.includes("remoteAccessRoutes.get('/tokens'"));
  assert.ok(routes.includes("remoteAccessRoutes.post('/tokens/revoke'"));
  assert.ok(routes.includes("remoteAccessRoutes.post('/tokens/revoke-by-id'"));
  assert.ok(
    routes.includes(
      'const providers = await getProviderAvailability(resolved, { autoInstall: false });',
    ),
  );
  assert.ok(
    routes.includes('const [availability] = await getProviderAvailability(resolved, {'),
  );
  assert.ok(routes.includes('requestedProvider: request.provider'));
  assert.ok(routes.includes('ensureProviderExecutableAvailable'));
});

test('web static serving enables cache headers for assets', () => {
  const web = read('src/web.ts');

  assert.ok(web.includes("app.use('/assets/*', serveStatic({"));
  assert.ok(web.includes('precompressed: true'));
  assert.ok(
    web.includes("c.header('Cache-Control', 'public, max-age=31536000, immutable')"),
  );
  assert.ok(
    web.includes("c.header('Cache-Control', 'no-cache')"),
  );
});
