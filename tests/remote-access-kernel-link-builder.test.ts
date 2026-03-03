import assert from 'node:assert/strict';
import test from 'node:test';

import { AccessLinkBuilder } from '../src/remote-access-kernel/link-builder.ts';

test('build access link with normalized path and extra query', () => {
  const builder = new AccessLinkBuilder();
  const link = builder.build({
    publicUrl: 'https://demo.example.com',
    token: 'abc123',
    path: 'chat',
    extraQuery: { lang: 'zh' },
  });

  assert.equal(link, 'https://demo.example.com/chat?token=abc123&lang=zh');
});

test('keep base path when custom path is omitted', () => {
  const builder = new AccessLinkBuilder();
  const link = builder.build({
    publicUrl: 'https://demo.example.com/base',
    token: 'abc123',
  });

  assert.equal(link, 'https://demo.example.com/base?token=abc123');
});

test('allow custom token query key', () => {
  const builder = new AccessLinkBuilder({ tokenQueryKey: 'access_token' });
  const link = builder.build({
    publicUrl: 'https://demo.example.com',
    token: 'abc123',
    path: '/im',
    extraQuery: { view: 'mobile' },
  });

  assert.equal(
    link,
    'https://demo.example.com/im?access_token=abc123&view=mobile',
  );
});

test('preserve query string in path when building access link', () => {
  const builder = new AccessLinkBuilder();
  const link = builder.build({
    publicUrl: 'https://demo.example.com',
    token: 'abc123',
    path: '/api/remote-access/public/entry?path=%2Fchat%2Fmain',
  });

  assert.equal(
    link,
    'https://demo.example.com/api/remote-access/public/entry?path=%2Fchat%2Fmain&token=abc123',
  );
});
