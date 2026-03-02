import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('agent-runner wires MCP builders for claude/codex and Gemini SDK list builder', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('buildClaudeMcpServers'));
  assert.ok(source.includes('buildCodexMcpServers'));
  assert.ok(source.includes('const claudeMcpServers = buildClaudeMcpServers('));
  assert.ok(source.includes('const codexMcpServers = buildCodexMcpServers('));
  assert.ok(source.includes('function buildGeminiSdkMcpServerList('));
  assert.ok(source.includes('buildGeminiSdkMcpServerList(mcpServerPath, containerInput)'));
});
