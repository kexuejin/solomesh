import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('importing auth module should not keep process alive', async () => {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--eval', "import './src/auth.ts'"],
    {
      cwd: process.cwd(),
      stdio: 'ignore',
    },
  );

  const exited = await new Promise<boolean>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 4_000);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });

  assert.equal(exited, true, 'auth module import should exit without forced kill');
});
