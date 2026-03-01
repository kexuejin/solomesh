import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readCookieName(nodeEnv: 'production' | 'development'): Promise<string> {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = nodeEnv;
  try {
    const configModuleUrl =
      pathToFileURL(path.resolve(process.cwd(), 'src/config.ts')).href +
      `?test=${Date.now()}-${Math.random()}`;
    const loaded = await import(configModuleUrl);
    return loaded.SESSION_COOKIE_NAME as string;
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
}

test('uses __Host-solomesh_session in production', async () => {
  assert.equal(await readCookieName('production'), '__Host-solomesh_session');
});

test('uses solomesh_session in development', async () => {
  assert.equal(await readCookieName('development'), 'solomesh_session');
});
