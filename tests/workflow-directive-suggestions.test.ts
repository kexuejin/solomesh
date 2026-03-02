import test from 'node:test';
import assert from 'node:assert/strict';

import { getWorkflowCommandSuggestions } from '../web/src/lib/workflow-directive';

test('workflow command suggestions still support /wf templates and controls', () => {
  const suggestions = getWorkflowCommandSuggestions('/wf');
  const values = suggestions.map((item) => item.value);
  assert.ok(values.includes('/wf competitor-watch'));
  assert.ok(values.includes('/wf project-recommendation'));
  assert.ok(values.includes('/wf-status'));
});

test('workflow command suggestions support /auto template hints', () => {
  const suggestions = getWorkflowCommandSuggestions('/auto');
  const values = suggestions.map((item) => item.value);
  assert.ok(values.includes('/auto'));
  assert.ok(values.includes('/auto competitor-watch'));
  assert.ok(values.includes('/auto project-recommendation'));
});

test('workflow command suggestions support /automation alias', () => {
  const suggestions = getWorkflowCommandSuggestions('/automation comp');
  const values = suggestions.map((item) => item.value);
  assert.deepEqual(values, ['/auto competitor-watch']);
});
