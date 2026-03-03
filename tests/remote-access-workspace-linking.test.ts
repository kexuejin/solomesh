import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkspaceAccessLinkRequest,
  buildWorkspaceChatPath,
  buildWorkspacePublicEntryPath,
  looksLikeRemoteAccessLinkRequest,
} from '../src/remote-access-kernel/workspace-linking.ts';

test('buildWorkspaceChatPath encodes folder name into /chat/:folder route', () => {
  assert.equal(buildWorkspaceChatPath('main'), '/chat/main');
  assert.equal(buildWorkspaceChatPath('my folder'), '/chat/my%20folder');
});

test('buildWorkspacePublicEntryPath always redirects to workspace route', () => {
  const path = buildWorkspacePublicEntryPath('team-a');
  assert.equal(path, '/chat/team-a');
});

test('buildWorkspaceAccessLinkRequest maps preference mode to request payload', () => {
  const tokenRequest = buildWorkspaceAccessLinkRequest('team-a', {
    mode: 'token',
    ttlSeconds: 1200,
    oneTime: true,
  });
  assert.deepEqual(tokenRequest, {
    mode: 'token',
    ttlSeconds: 1200,
    oneTime: true,
    path: '/chat/team-a',
  });

  const publicRequest = buildWorkspaceAccessLinkRequest('team-a', {
    mode: 'public',
    ttlSeconds: 1200,
    oneTime: true,
  });
  assert.deepEqual(publicRequest, {
    mode: 'public',
    path: '/chat/team-a',
  });
});

test('looksLikeRemoteAccessLinkRequest matches zh/en request phrases', () => {
  assert.equal(looksLikeRemoteAccessLinkRequest('给我这个工作区的远程访问链接'), true);
  assert.equal(looksLikeRemoteAccessLinkRequest('please share remote access for this workspace'), true);
  assert.equal(looksLikeRemoteAccessLinkRequest('继续执行这个任务'), false);
});
