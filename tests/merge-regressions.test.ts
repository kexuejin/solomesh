import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('web server mounts mcp-servers routes', () => {
  const web = read('src/web.ts');

  assert.ok(web.includes("import mcpServersRoutes from './routes/mcp-servers.js';"));
  assert.ok(web.includes("app.route('/api/mcp-servers', mcpServersRoutes);"));
});

test('settings includes mcp-servers tab entry and page render', () => {
  const settingsTypes = read('web/src/components/settings/types.ts');
  const settingsNav = read('web/src/components/settings/SettingsNav.tsx');
  const settingsPage = read('web/src/pages/SettingsPage.tsx');

  assert.ok(settingsTypes.includes("| 'mcp-servers'"));
  assert.ok(settingsNav.includes("key: 'mcp-servers'"));
  assert.ok(settingsPage.includes("'mcp-servers'"));
  assert.ok(settingsPage.includes("'mcp-servers': 'settings.tabs.mcpServers'"));
  assert.ok(settingsPage.includes("activeTab === 'mcp-servers' && <McpServersPage />"));
});

test('skills route exposes sync-host endpoint expected by frontend', () => {
  const skillsRoutes = read('src/routes/skills.ts');
  assert.ok(skillsRoutes.includes("skillsRoutes.post('/sync-host'"));
});

test('skills card does not trigger toggle API from UI', () => {
  const skillCard = read('web/src/components/skills/SkillCard.tsx');
  assert.ok(!skillCard.includes('toggleSkill('));
});
