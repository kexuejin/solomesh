import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ensureProviderExecutableAvailable,
  isExecutableAvailable,
} from '../src/remote-access-kernel/provider-availability.ts';

test('isExecutableAvailable resolves absolute executable path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-access-bin-'));
  const executable = path.join(tmpDir, 'cloudflared');
  fs.writeFileSync(executable, '#!/bin/sh\necho ok\n', { mode: 0o755 });

  assert.equal(isExecutableAvailable(executable), true);
  assert.equal(isExecutableAvailable(path.join(tmpDir, 'missing')), false);
});

test('isExecutableAvailable resolves command from PATH entries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-access-path-'));
  const executable = path.join(tmpDir, 'ngrok');
  fs.writeFileSync(executable, '#!/bin/sh\necho ok\n', { mode: 0o755 });

  const fakeEnv = { ...process.env, PATH: tmpDir };
  assert.equal(isExecutableAvailable('ngrok', fakeEnv), true);
  assert.equal(isExecutableAvailable('cloudflared', fakeEnv), false);
});

test('ensureProviderExecutableAvailable returns true when already available', async () => {
  let commandCalled = false;
  const available = await ensureProviderExecutableAvailable('ngrok', 'ngrok', {
    checkExecutable: (cmd) => cmd === 'ngrok',
    runCommand: async () => {
      commandCalled = true;
      return true;
    },
  });

  assert.equal(available, true);
  assert.equal(commandCalled, false);
});

test('ensureProviderExecutableAvailable installs ngrok via brew when missing', async () => {
  let installed = false;
  const commands: string[] = [];
  const available = await ensureProviderExecutableAvailable('ngrok', 'ngrok', {
    checkExecutable: (cmd) => {
      if (cmd === 'brew') return true;
      if (cmd === 'ngrok') return installed;
      return false;
    },
    runCommand: async (command, args) => {
      commands.push(`${command} ${args.join(' ')}`);
      installed = command === 'brew' && args[0] === 'install';
      return true;
    },
  });

  assert.equal(available, true);
  assert.deepEqual(commands, ['brew install ngrok']);
});

test('ensureProviderExecutableAvailable returns false when brew is unavailable', async () => {
  const available = await ensureProviderExecutableAvailable(
    'cloudflared',
    'cloudflared',
    {
      checkExecutable: () => false,
      runCommand: async () => true,
    },
  );

  assert.equal(available, false);
});
