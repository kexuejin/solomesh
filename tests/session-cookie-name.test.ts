import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function readCookieName(nodeEnv: 'production' | 'development'): string {
  const output = execFileSync(
    'npx',
    [
      'tsx',
      '--eval',
      "import { SESSION_COOKIE_NAME } from './src/config.ts'; console.log(SESSION_COOKIE_NAME);",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: nodeEnv },
      encoding: 'utf8',
    },
  );
  return output.trim();
}

test('uses __Host-solomesh_session in production', () => {
  assert.equal(readCookieName('production'), '__Host-solomesh_session');
});

test('uses solomesh_session in development', () => {
  assert.equal(readCookieName('development'), 'solomesh_session');
});

