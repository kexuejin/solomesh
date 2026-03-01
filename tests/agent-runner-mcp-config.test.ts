import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  loadRawUserMcpServers,
  normalizeUserMcpServers,
  buildClaudeMcpServers,
  buildCodexMcpServers,
  buildGeminiMcpServers,
} from '../container/agent-runner/src/mcp-config.ts';

test('normalizeUserMcpServers keeps valid servers and drops disabled/invalid entries', () => {
  const normalized = normalizeUserMcpServers({
    stdioA: {
      command: 'npx',
      args: ['-y', 'foo@latest'],
      env: { FOO: '1' },
      enabled: true,
    },
    httpA: {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      enabled: true,
    },
    sseA: {
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
    },
    disabledA: {
      command: 'echo',
      enabled: false,
    },
    invalidA: {
      type: 'http',
      url: 123,
      enabled: true,
    },
  });

  assert.deepEqual(Object.keys(normalized).sort(), ['httpA', 'sseA', 'stdioA']);
  assert.equal(normalized.stdioA.transport, 'stdio');
  assert.equal(normalized.httpA.transport, 'http');
  assert.equal(normalized.sseA.transport, 'sse');
});

test('buildClaudeMcpServers maps normalized entries and protects built-in solomesh', () => {
  const normalized = normalizeUserMcpServers({
    solomesh: {
      command: 'evil-cmd',
      enabled: true,
    },
    stdioA: {
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { A: '1' },
      enabled: true,
    },
    httpA: {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { X: '1' },
      enabled: true,
    },
  });

  const builtInSolomesh = { marker: 'builtin' };
  const claude = buildClaudeMcpServers(normalized, builtInSolomesh);

  assert.deepEqual((claude.stdioA as any).command, 'npx');
  assert.deepEqual((claude.httpA as any).type, 'http');
  assert.deepEqual((claude.httpA as any).url, 'https://example.com/mcp');
  assert.deepEqual((claude.solomesh as any).marker, 'builtin');
});

test('buildCodexMcpServers maps http headers and protects built-in solomesh', () => {
  const normalized = normalizeUserMcpServers({
    solomesh: {
      command: 'evil-cmd',
      enabled: true,
    },
    stdioA: {
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { A: '1' },
      enabled: true,
    },
    sseA: {
      type: 'sse',
      url: 'https://example.com/sse',
      headers: { Authorization: 'Bearer token' },
      enabled: true,
    },
  });

  const builtInSolomesh = {
    command: 'node',
    args: ['/app/ipc-mcp-stdio.js'],
    env: { SOLOMESH_CHAT_JID: 'test' },
  };
  const codex = buildCodexMcpServers(normalized, builtInSolomesh);

  assert.deepEqual((codex.stdioA as any).command, 'npx');
  assert.deepEqual((codex.sseA as any).url, 'https://example.com/sse');
  assert.deepEqual((codex.sseA as any).http_headers.Authorization, 'Bearer token');
  assert.deepEqual((codex.solomesh as any).command, 'node');
});

test('buildGeminiMcpServers maps normalized entries and protects built-in solomesh', () => {
  const normalized = normalizeUserMcpServers({
    solomesh: {
      command: 'evil-cmd',
      enabled: true,
    },
    stdioA: {
      command: 'npx',
      args: ['-y', 'pkg'],
      env: { A: '1' },
      enabled: true,
    },
    httpA: {
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { X: '1' },
      enabled: true,
    },
  });

  const builtInSolomesh = {
    command: 'node',
    args: ['/app/ipc-mcp-stdio.js'],
    env: { SOLOMESH_CHAT_JID: 'test' },
  };
  const gemini = buildGeminiMcpServers(normalized, builtInSolomesh);

  assert.deepEqual((gemini.stdioA as any).command, 'npx');
  assert.deepEqual((gemini.httpA as any).type, 'http');
  assert.deepEqual((gemini.httpA as any).url, 'https://example.com/mcp');
  assert.deepEqual((gemini.solomesh as any).command, 'node');
});

test('loadRawUserMcpServers reads from CLAUDE_CONFIG_DIR/settings.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solomesh-mcp-'));
  const settingsPath = path.join(tmpDir, 'settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      mcpServers: {
        stdioA: {
          command: 'npx',
          args: ['-y', 'foo'],
        },
      },
    }),
    'utf-8',
  );

  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;

  try {
    const raw = loadRawUserMcpServers();
    assert.equal((raw.stdioA as any).command, 'npx');
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadRawUserMcpServers returns empty object on invalid JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solomesh-mcp-'));
  const settingsPath = path.join(tmpDir, 'settings.json');
  fs.writeFileSync(settingsPath, '{ invalid json', 'utf-8');

  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tmpDir;

  try {
    const raw = loadRawUserMcpServers();
    assert.deepEqual(raw, {});
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
