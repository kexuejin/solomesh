import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('db includes todo tables and indexes', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS todos'));
  assert.ok(source.includes('CREATE TABLE IF NOT EXISTS todo_source_events'));
  assert.ok(source.includes('UNIQUE(dedupe_key)'));
  assert.ok(source.includes('idx_todos_status_priority_last_seen'));
  assert.ok(source.includes('idx_todo_source_events_todo_created_at'));
});

test('db exports todo repository helpers', () => {
  const source = read('src/db.ts');
  assert.ok(source.includes('export function getTodoByDedupeKey'));
  assert.ok(source.includes('export function insertTodo('));
  assert.ok(source.includes('export function updateTodoMerge('));
  assert.ok(source.includes('export function insertTodoSourceEvent('));
  assert.ok(source.includes('export function listTodoSourceEvents('));
  assert.ok(source.includes('export function listTodos('));
});
