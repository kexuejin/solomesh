import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runGeminiQuery always routes Gemini runtime to SDK path', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('return runGeminiSdkQuery('));
  assert.ok(!source.includes('runGeminiCliQuery('));
  assert.ok(!source.includes('normalizeGeminiAuthMode(envSource.GEMINI_AUTH_MODE)'));
});

test('gemini sdk sessions are cleaned up before process exit and at normal shutdown', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('async function cleanupGeminiSdkSessions(): Promise<void> {'));
  assert.ok(source.includes('await cleanupGeminiSdkSessions();\n        writeOutput({'));
  assert.ok(source.includes('await cleanupGeminiSdkSessions();\n    // 不在 error output 中携带 sessionId：'));
  assert.ok(source.includes('\n  await cleanupGeminiSdkSessions();\n}'));
});

test('runGeminiSdkQuery emits thinking_delta when sdk chunk includes thought parts', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('extractGeminiSdkChunkDeltas(chunk, {'));
  assert.ok(source.includes("streamEvent: { eventType: 'thinking_delta', text: deltas.thinkingDelta }"));
});

test('runGeminiSdkQuery maps gemini sdk function call chunks to tool stream events', () => {
  const source = read('container/agent-runner/src/index.ts');

  assert.ok(source.includes('extractGeminiSdkChunkToolEvents(chunk, toolStreamState);'));
  assert.ok(source.includes("streamEvent: { ...toolEvent }"));
  assert.ok(source.includes("parentToolUseId: null"));
  assert.ok(source.includes("isNested: false"));
});
