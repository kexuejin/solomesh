import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('runtime-config exports runtime-neutral API names', () => {
  const source = read('src/runtime-config.ts');

  assert.ok(source.includes('export interface RuntimeProviderConfig'));
  assert.ok(source.includes('export interface RuntimeProviderPublicConfig'));
  assert.ok(source.includes('export function getRuntimeProviderConfig()'));
  assert.ok(source.includes('export function saveRuntimeProviderConfig('));
  assert.ok(source.includes('export function validateRuntimeProviderConfig('));
  assert.ok(source.includes('export function toPublicRuntimeProviderConfig('));
  assert.ok(source.includes('export function getGlobalRuntimeCustomEnv()'));
  assert.ok(source.includes('export function saveGlobalRuntimeCustomEnv('));
  assert.ok(source.includes('export function buildRuntimeEnvLines('));
  assert.ok(source.includes('export function appendRuntimeConfigAudit('));
  assert.ok(source.includes('export function mergeRuntimeEnvConfig('));

  assert.ok(!source.includes('export interface ClaudeProviderConfig'));
  assert.ok(!source.includes('export interface ClaudeProviderPublicConfig'));
  assert.ok(!source.includes('export function getClaudeProviderConfig('));
  assert.ok(!source.includes('export function saveClaudeProviderConfig('));
  assert.ok(!source.includes('export function validateClaudeProviderConfig('));
  assert.ok(!source.includes('export function toPublicClaudeProviderConfig('));
  assert.ok(!source.includes('export function getGlobalClaudeCustomEnv('));
  assert.ok(!source.includes('export function saveGlobalClaudeCustomEnv('));
  assert.ok(!source.includes('export function buildClaudeEnvLines('));
  assert.ok(!source.includes('export function appendClaudeConfigAudit('));
  assert.ok(!source.includes('export function mergeClaudeEnvConfig('));
});

test('schemas export runtime-neutral config schema names', () => {
  const source = read('src/schemas.ts');

  assert.ok(source.includes('export const RuntimeConfigSchema'));
  assert.ok(source.includes('export const RuntimeSecretsSchema'));
  assert.ok(source.includes('export const RuntimeCustomEnvSchema'));

  assert.ok(!source.includes('export const ClaudeConfigSchema'));
  assert.ok(!source.includes('export const ClaudeSecretsSchema'));
  assert.ok(!source.includes('export const ClaudeCustomEnvSchema'));
});
