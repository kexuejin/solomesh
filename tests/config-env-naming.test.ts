import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function readConfigWithEnv(env: Record<string, string | undefined>): {
  appName: string;
  agentImage: string;
} {
  const output = execFileSync(
    'npx',
    [
      'tsx',
      '--eval',
      [
        "import { APP_NAME, AGENT_IMAGE } from './src/config.ts';",
        'console.log(JSON.stringify({ appName: APP_NAME, agentImage: AGENT_IMAGE }));',
      ].join(' '),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    },
  );
  return JSON.parse(output.trim()) as { appName: string; agentImage: string };
}

test('reads new APP_NAME and AGENT_IMAGE env keys', () => {
  const cfg = readConfigWithEnv({
    APP_NAME: 'SoloMesh Pro',
    AGENT_IMAGE: 'solomesh-agent:test',
    ASSISTANT_NAME: undefined,
    CONTAINER_IMAGE: undefined,
  });
  assert.equal(cfg.appName, 'SoloMesh Pro');
  assert.equal(cfg.agentImage, 'solomesh-agent:test');
});

test('does not read legacy ASSISTANT_NAME and CONTAINER_IMAGE', () => {
  const cfg = readConfigWithEnv({
    ASSISTANT_NAME: 'LegacyName',
    CONTAINER_IMAGE: 'legacy-agent:old',
    APP_NAME: undefined,
    AGENT_IMAGE: undefined,
  });
  assert.equal(cfg.appName, 'SoloMesh');
  assert.equal(cfg.agentImage, 'solomesh-agent:latest');
});

