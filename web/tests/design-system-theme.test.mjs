import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'web');
const globalsCss = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');

test('theme tokens use SoloMesh modern enterprise palette', () => {
  assert.match(globalsCss, /--primary:\s*#0f6bff;/i);
  assert.match(globalsCss, /--background:\s*#f5f7fb;/i);
  assert.match(globalsCss, /--card:\s*#ffffff;/i);
  assert.match(globalsCss, /--ring:\s*#0f6bff;/i);
  assert.match(globalsCss, /--radius:\s*0\.875rem;/i);
});

test('document uses Manrope and IBM Plex Sans web fonts', () => {
  assert.match(indexHtml, /family=Manrope/i);
  assert.match(indexHtml, /family=IBM\+Plex\+Sans/i);
  assert.doesNotMatch(indexHtml, /family=Inter/i);
});

test('pwa theme color uses SoloMesh primary', () => {
  assert.match(indexHtml, /meta name="theme-color" content="#0f6bff"/i);
});
