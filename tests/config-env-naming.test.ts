import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function readConfigWithEnv(env: Record<string, string | undefined>): Promise<{
  appName: string;
  agentImage: string;
}> {
  const trackedKeys = Object.keys(env);
  const originalEntries = new Map<string, string | undefined>();
  for (const key of trackedKeys) {
    originalEntries.set(key, process.env[key]);
    const nextValue = env[key];
    if (nextValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = nextValue;
    }
  }

  try {
    const configModuleUrl =
      pathToFileURL(path.resolve(process.cwd(), 'src/config.ts')).href +
      `?test=${Date.now()}-${Math.random()}`;
    const loaded = await import(configModuleUrl);
    return {
      appName: loaded.APP_NAME as string,
      agentImage: loaded.AGENT_IMAGE as string,
    };
  } finally {
    for (const key of trackedKeys) {
      const originalValue = originalEntries.get(key);
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
  }
}

test('reads new APP_NAME and AGENT_IMAGE env keys', async () => {
  const cfg = await readConfigWithEnv({
    APP_NAME: 'SoloMesh Pro',
    AGENT_IMAGE: 'solomesh-agent:test',
    ASSISTANT_NAME: undefined,
    CONTAINER_IMAGE: undefined,
  });
  assert.equal(cfg.appName, 'SoloMesh Pro');
  assert.equal(cfg.agentImage, 'solomesh-agent:test');
});

test('does not read legacy ASSISTANT_NAME and CONTAINER_IMAGE', async () => {
  const cfg = await readConfigWithEnv({
    ASSISTANT_NAME: 'LegacyName',
    CONTAINER_IMAGE: 'legacy-agent:old',
    APP_NAME: undefined,
    AGENT_IMAGE: undefined,
  });
  assert.equal(cfg.appName, 'SoloMesh');
  assert.equal(cfg.agentImage, 'solomesh-agent:latest');
});
