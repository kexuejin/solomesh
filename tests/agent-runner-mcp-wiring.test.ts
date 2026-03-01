import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('agent-runner wires provider-neutral mcp builders for claude/codex/gemini', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('buildClaudeMcpServers'));
  assert.ok(source.includes('buildCodexMcpServers'));
  assert.ok(source.includes('buildGeminiMcpServers'));
  assert.ok(source.includes('const claudeMcpServers = buildClaudeMcpServers('));
  assert.ok(source.includes('const codexMcpServers = buildCodexMcpServers('));
  assert.ok(source.includes('const geminiMcpServers = buildGeminiMcpServers('));
  assert.ok(source.includes('ensureGeminiSettingsJson(cliHome, geminiMcpServers);'));
});
