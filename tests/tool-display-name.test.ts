import test from 'node:test';
import assert from 'node:assert/strict';

import { formatToolDisplayName } from '../web/src/lib/tool-display.ts';

test('formatToolDisplayName keeps built-in task and skill names unchanged', () => {
  assert.equal(formatToolDisplayName('Task'), 'Task');
  assert.equal(formatToolDisplayName('Skill'), 'Skill');
});

test('formatToolDisplayName keeps non-mcp names unchanged', () => {
  assert.equal(formatToolDisplayName('Bash'), 'Bash');
  assert.equal(
    formatToolDisplayName('https://example.com/tool'),
    'https://example.com/tool',
  );
});

test('formatToolDisplayName renders mcp names as readable server/tool labels', () => {
  assert.equal(
    formatToolDisplayName('mcp__solomesh__search_files'),
    'Solomesh / search_files',
  );
  assert.equal(
    formatToolDisplayName('mcp__chrome-devtools__list_network_requests'),
    'Chrome Devtools / list_network_requests',
  );
});
