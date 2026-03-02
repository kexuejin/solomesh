import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const FILES = [
  'web/src/components/chat/ChatView.tsx',
  'web/src/components/chat/ChatSidebar.tsx',
  'web/src/components/chat/ChatGroupItem.tsx',
  'web/src/components/chat/CreateContainerDialog.tsx',
  'web/src/components/chat/EditWorkspaceDirectoryDialog.tsx',
  'web/src/components/chat/MessageList.tsx',
  'web/src/components/chat/StreamingDisplay.tsx',
  'web/src/components/chat/FileUploadZone.tsx',
  'web/src/components/chat/MermaidDiagram.tsx',
  'web/src/components/chat/MessageInput.tsx',
  'web/src/components/chat/TerminalPanel.tsx',
  'web/src/components/chat/TaskInlineCard.tsx',
  'web/src/components/chat/ContainerEnvPanel.tsx',
  'web/src/components/chat/FilePanel.tsx',
  'web/src/components/chat/MessageContextMenu.tsx',
  'web/src/components/chat/ImageLightbox.tsx',
  'web/src/components/chat/MessageBubble.tsx',
  'web/src/components/chat/MarkdownRenderer.tsx',
  'web/src/components/chat/AgentStatusCard.tsx',
  'web/src/components/chat/GroupMembersPanel.tsx',
  'web/src/components/chat/GroupSkillsPanel.tsx',
  'web/src/components/chat/AgentTabBar.tsx',
] as const;

const CHAT_PANEL_LITERAL_GUARD = [
  'placeholder="https://github.com/user/repo"',
  'placeholder="KEY"',
  'placeholder="value"',
] as const;

test('chat side panels use i18n dictionary keys', () => {
  for (const relPath of FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

test('chat dialogs avoid hardcoded setup placeholders', () => {
  for (const relPath of [
    'web/src/components/chat/CreateContainerDialog.tsx',
    'web/src/components/chat/ContainerEnvPanel.tsx',
  ] as const) {
    const source = read(relPath);
    for (const literal of CHAT_PANEL_LITERAL_GUARD) {
      assert.ok(!source.includes(literal), `${relPath} should not include hardcoded literal: ${literal}`);
    }
  }
});

test('container env panel uses i18n for gemini api key tab label', () => {
  const source = read('web/src/components/chat/ContainerEnvPanel.tsx');
  assert.ok(!/>\s*API Key\s*</.test(source), 'ContainerEnvPanel should use i18n for API Key tab label');
});
