import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('settings page uses constrained flex layout so mobile content can scroll', () => {
  const source = read('web/src/pages/SettingsPage.tsx');

  assert.ok(
    source.includes('className="h-full min-h-0 app-canvas flex flex-col lg:flex-row"'),
    'settings root should be height-constrained for nested scrolling',
  );
  assert.ok(
    source.includes('className="min-h-0 flex-1 overflow-y-auto"'),
    'settings content area should be shrinkable and scrollable',
  );
});

test('app layout keeps non-chat routes vertically scrollable on mobile', () => {
  const source = read('web/src/components/layout/AppLayout.tsx');

  assert.ok(
    source.includes('const isChatRoute = location.pathname.startsWith(\'/chat\');'),
    'app layout should differentiate chat route from other pages',
  );
  assert.ok(
    source.includes("?'flex-1 overflow-hidden lg:overflow-auto lg:pb-0'")
      || source.includes("? 'flex-1 overflow-hidden lg:overflow-auto lg:pb-0'"),
    'chat route should keep main container overflow-hidden on mobile',
  );
  assert.ok(
    source.includes(": 'flex-1 overflow-y-auto overflow-x-hidden lg:overflow-auto lg:pb-0'"),
    'non-chat routes should allow mobile vertical scrolling in main container',
  );
});
