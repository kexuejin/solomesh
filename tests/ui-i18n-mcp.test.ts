import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/pages/McpServersPage.tsx',
  'web/src/components/mcp-servers/AddMcpServerDialog.tsx',
  'web/src/components/mcp-servers/McpServerDetail.tsx',
  'web/src/components/mcp-servers/McpServerCard.tsx',
] as const;

const MCP_LITERAL_GUARD = [
  'my-mcp-server',
  'https://mcp.example.com',
  'https://...',
  'Header-Name',
  'Bearer token...',
  'npx, uvx, node...',
  'placeholder="KEY"',
  'placeholder="value"',
] as const;

test('mcp module uses i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

test('mcp dialogs do not keep hardcoded placeholder literals', () => {
  for (const relPath of [
    'web/src/components/mcp-servers/AddMcpServerDialog.tsx',
    'web/src/components/mcp-servers/McpServerDetail.tsx',
  ] as const) {
    const source = read(relPath);
    for (const literal of MCP_LITERAL_GUARD) {
      assert.ok(!source.includes(literal), `${relPath} should not include hardcoded literal: ${literal}`);
    }
  }
});
