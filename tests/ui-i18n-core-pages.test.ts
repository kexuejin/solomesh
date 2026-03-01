import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const CORE_UI_FILES = [
  'web/src/pages/ChatPage.tsx',
  'web/src/pages/TasksPage.tsx',
  'web/src/pages/MonitorPage.tsx',
  'web/src/pages/SetupChannelsPage.tsx',
  'web/src/components/tasks/CreateTaskForm.tsx',
  'web/src/components/tasks/TaskCard.tsx',
  'web/src/components/tasks/TaskDetail.tsx',
  'web/src/components/monitor/ContainerStatus.tsx',
  'web/src/components/monitor/QueueStatus.tsx',
  'web/src/components/monitor/SystemInfo.tsx',
  'web/src/components/monitor/GroupStatusCard.tsx',
] as const;

test('core pages/components use i18n keys instead of hardcoded Chinese copy', () => {
  for (const relPath of CORE_UI_FILES) {
    const source = read(relPath);
    assert.ok(source.includes('useI18n'), `${relPath} should use useI18n`);
    assert.ok(!/[一-龥]/.test(source), `${relPath} should not contain hardcoded Chinese literals`);
  }
});

test('monitor system info avoids hardcoded runtime label text', () => {
  const source = read('web/src/components/monitor/SystemInfo.tsx');
  assert.ok(!source.includes('>Claude Code<'));
});
