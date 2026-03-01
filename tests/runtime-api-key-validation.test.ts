import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContainerEnvLines,
  buildRuntimeEnvLines,
  getRuntimeApiKeyAutoRepairPatch,
  mergeRuntimeEnvConfig,
  toPublicContainerEnvConfig,
  toPublicRuntimeProviderConfig,
  validateRuntimeProviderConfig,
  type RuntimeProviderConfig,
} from '../src/runtime-config.js';

async function withEnvOverrides(
  overrides: Record<string, string | undefined>,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function createBaseConfig(): RuntimeProviderConfig {
  return {
    agentRuntime: 'codex',
    anthropicBaseUrl: '',
    codexBaseUrl: 'https://example.com/openai',
    codexModel: 'gpt-5-codex',
    geminiBaseUrl: '',
    geminiModel: 'gemini-2.5-pro',
    geminiAuthMode: 'api_key',
    anthropicAuthToken: '',
    anthropicApiKey: '',
    claudeCodeOauthToken: '',
    codexApiKey: 'sk-valid-key-123',
    geminiApiKey: '',
    claudeOAuthCredentials: null,
    updatedAt: null,
  };
}

test('validateRuntimeProviderConfig keeps runtime URL checks independent from stale API key values', () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  config.geminiApiKey = 'https://generativelanguage.googleapis.com';

  const errors = validateRuntimeProviderConfig(config);

  assert.equal(errors.length, 0);
});

test('buildRuntimeEnvLines skips invalid codex key when env fallback is absent', async () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    },
    () => {
      const lines = buildRuntimeEnvLines(config);
      assert.ok(
        !lines.some((line) => line.startsWith('CODEX_API_KEY=')),
        `unexpected CODEX_API_KEY line: ${lines.join(', ')}`,
      );
      assert.ok(
        !lines.some((line) => line.startsWith('OPENAI_API_KEY=')),
        `unexpected OPENAI_API_KEY line: ${lines.join(', ')}`,
      );
    },
  );
});

test('buildRuntimeEnvLines falls back to env key when saved codex key is invalid', async () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: 'sk-env-fallback-456',
      OPENAI_API_KEY: undefined,
    },
    () => {
      const lines = buildRuntimeEnvLines(config);
      assert.ok(lines.includes('CODEX_API_KEY=sk-env-fallback-456'));
      assert.ok(lines.includes('OPENAI_API_KEY=sk-env-fallback-456'));
    },
  );
});

test('buildContainerEnvLines also falls back to env key for container mode', async () => {
  const global = createBaseConfig();
  global.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: 'sk-env-container-789',
      OPENAI_API_KEY: undefined,
    },
    () => {
      const lines = buildContainerEnvLines(global, {
        agentRuntime: 'codex',
      });
      assert.ok(lines.includes('CODEX_API_KEY=sk-env-container-789'));
      assert.ok(lines.includes('OPENAI_API_KEY=sk-env-container-789'));
    },
  );
});

test('mergeRuntimeEnvConfig keeps global codex key when override key is invalid', () => {
  const global = createBaseConfig();
  const merged = mergeRuntimeEnvConfig(global, {
    codexApiKey: 'https://gateway.example.com/openai',
  });

  assert.equal(merged.codexApiKey, global.codexApiKey);
});

test('toPublicRuntimeProviderConfig does not mark URL-like codex key as connected without env fallback', async () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    },
    () => {
      const publicConfig = toPublicRuntimeProviderConfig(config);
      assert.equal(publicConfig.hasCodexApiKey, false);
      assert.equal(publicConfig.codexApiKeyMasked, null);
      assert.equal(publicConfig.codexApiKeySource, 'none');
      assert.equal(publicConfig.codexApiKeyDegraded, true);
    },
  );
});

test('toPublicRuntimeProviderConfig marks codex as connected via env fallback', async () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: 'sk-env-fallback-456',
      OPENAI_API_KEY: undefined,
    },
    () => {
      const publicConfig = toPublicRuntimeProviderConfig(config);
      assert.equal(publicConfig.hasCodexApiKey, true);
      assert.ok(publicConfig.codexApiKeyMasked?.startsWith('sk-'));
      assert.equal(publicConfig.codexApiKeySource, 'env');
      assert.equal(publicConfig.codexApiKeyDegraded, true);
    },
  );
});

test('toPublicRuntimeProviderConfig prefers valid runtime key without degradation', () => {
  const config = createBaseConfig();
  const publicConfig = toPublicRuntimeProviderConfig(config);

  assert.equal(publicConfig.hasCodexApiKey, true);
  assert.equal(publicConfig.codexApiKeySource, 'runtime');
  assert.equal(publicConfig.codexApiKeyDegraded, false);
});

test('toPublicContainerEnvConfig prefers workspace override key when valid', () => {
  const global = createBaseConfig();
  const publicConfig = toPublicContainerEnvConfig(
    {
      codexApiKey: 'sk-workspace-override-001',
    },
    global,
  );

  assert.equal(publicConfig.hasCodexApiKey, true);
  assert.equal(publicConfig.codexApiKeySource, 'override');
  assert.equal(publicConfig.codexApiKeyDegraded, false);
});

test('toPublicContainerEnvConfig falls back to global key when workspace override is invalid', () => {
  const global = createBaseConfig();
  const publicConfig = toPublicContainerEnvConfig(
    {
      codexApiKey: 'https://gateway.example.com/openai',
    },
    global,
  );

  assert.equal(publicConfig.hasCodexApiKey, true);
  assert.equal(publicConfig.codexApiKeySource, 'runtime');
  assert.equal(publicConfig.codexApiKeyDegraded, true);
});

test('toPublicContainerEnvConfig falls back to env when runtime/global key is invalid', async () => {
  const global = createBaseConfig();
  global.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: 'sk-env-fallback-container-001',
      OPENAI_API_KEY: undefined,
    },
    () => {
      const publicConfig = toPublicContainerEnvConfig(
        {
          codexApiKey: '',
        },
        global,
      );
      assert.equal(publicConfig.hasCodexApiKey, true);
      assert.equal(publicConfig.codexApiKeySource, 'env');
      assert.equal(publicConfig.codexApiKeyDegraded, true);
    },
  );
});

test('getRuntimeApiKeyAutoRepairPatch repairs url-like codex key from env fallback', async () => {
  const config = createBaseConfig();
  config.codexApiKey = 'https://gateway.example.com/openai';
  await withEnvOverrides(
    {
      CODEX_API_KEY: 'sk-repaired-001',
      OPENAI_API_KEY: undefined,
    },
    () => {
      const { changedFields, nextConfig } = getRuntimeApiKeyAutoRepairPatch(
        config,
      );
      assert.deepEqual(changedFields, ['codexApiKey:auto_repair_from_env']);
      assert.equal(nextConfig.codexApiKey, 'sk-repaired-001');
    },
  );
});

test('getRuntimeApiKeyAutoRepairPatch does not repair gemini key in oauth mode', async () => {
  const config = createBaseConfig();
  config.agentRuntime = 'gemini';
  config.geminiAuthMode = 'oauth';
  config.geminiApiKey = 'https://generativelanguage.googleapis.com';
  await withEnvOverrides(
    {
      GEMINI_API_KEY: 'gm-valid-001',
      GOOGLE_API_KEY: undefined,
    },
    () => {
      const { changedFields, nextConfig } = getRuntimeApiKeyAutoRepairPatch(
        config,
      );
      assert.equal(changedFields.length, 0);
      assert.equal(
        nextConfig.geminiApiKey,
        'https://generativelanguage.googleapis.com',
      );
    },
  );
});
