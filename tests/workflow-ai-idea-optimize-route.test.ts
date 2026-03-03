import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('workflow routes provide ai idea optimize endpoint', () => {
  const source = read('src/routes/workflows.ts');

  assert.ok(
    source.includes('const OptimizeWorkflowIdeaSchema = z.object({'),
    'workflows route should define optimize workflow idea schema',
  );
  assert.ok(
    source.includes("workflowsRoutes.post('/templates/idea-optimize', authMiddleware, async (c) => {"),
    'workflows route should expose templates/idea-optimize endpoint',
  );
  assert.ok(
    source.includes('buildWorkflowIdeaOptimizePrompt'),
    'workflows route should build dedicated prompt for idea optimization',
  );
});
