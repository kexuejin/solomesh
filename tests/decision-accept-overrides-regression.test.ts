import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('decision accept route validates optional todo overrides', () => {
  const schemas = read('src/schemas.ts');
  const routes = read('src/routes/decision-items.ts');

  assert.ok(schemas.includes('DecisionItemAcceptSchema'));
  assert.ok(routes.includes('DecisionItemAcceptSchema'));
  assert.ok(routes.includes("decisionItemsRoutes.post('/:id/accept'"));
  assert.ok(routes.includes('DecisionItemAcceptSchema.safeParse'));
  assert.ok(routes.includes('acceptDecisionItem(id, authUser.id, validation.data)'));
});

test('decision core accepts todo overrides when accepting suggestion', () => {
  const core = read('src/decision-core.ts');

  assert.ok(core.includes('export interface DecisionItemAcceptOverrides'));
  assert.ok(core.includes('acceptDecisionItem('));
  assert.ok(core.includes('overrides?: DecisionItemAcceptOverrides'));
  assert.ok(core.includes('overrides?.title'));
  assert.ok(core.includes('overrides?.description'));
  assert.ok(core.includes('overrides?.priority'));
});

test('decision center store and page support accept-with-edit flow', () => {
  const store = read('web/src/stores/decision-items.ts');
  const page = read('web/src/pages/DecisionCenterPage.tsx');

  assert.ok(store.includes('acceptItem: (id: string, overrides?:'));
  assert.ok(store.includes('`/api/decision-items/${id}/accept`, overrides ?? {}'));
  assert.ok(page.includes('decisionCenter.actions.acceptWithEdit'));
  assert.ok(page.includes('decisionCenter.item.editableTodoDraft'));
});
