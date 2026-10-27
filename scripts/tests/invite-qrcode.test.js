'use strict';
/**
 * 专属邀请小程序码：
 * - scene 只放 6 位邀请码，落地首页，check_path=false 才能在未发布时也生成
 * - 同一用户同一版本只生成一次，结果缓存在邀请码文档上
 * - 线上还没这一版时退到体验版；接口不可用时只降级这块卡片，邀请码和分享仍然可用
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, A, tenant } = require('../test-support/tenant-services.cjs');

function stubCloud(f, fail) {
  const generated = [], uploaded = [];
  f.cloud.openapi.wxacode = {
    getUnlimited: async data => {
      generated.push(data);
      const errCode = fail && fail(data);
      if (errCode) throw Object.assign(new Error('openapi.wxacode.getUnlimited:fail invalid page'), { errCode });
      return { buffer: Buffer.from('png-bytes') };
    }
  };
  f.cloud.uploadFile = async data => { uploaded.push(data); return { fileID: 'cloud://env/' + data.cloudPath }; };
  f.cloud.getTempFileURL = async ({ fileList }) => ({
    fileList: fileList.map(item => ({ fileID: item.fileID, tempFileURL: 'https://cdn.example/qr.png?sign=' + item.maxAge }))
  });
  return { generated, uploaded };
}

async function setup(fail) {
  const f = fixture();
  await f.setup();
  return { f, ...stubCloud(f, fail), service: new (f.service('invite_service'))() };
}

test('the invite QR carries the code in scene, uses an unchecked page path and is generated only once', async () => {
  const { f, generated, uploaded, service } = await setup();
  const first = await tenant.run(A, () => service.getMyInviteQr('poster'));

  assert.match(first.code, /^[A-Z0-9]{6}$/);
  assert.equal(first.envVersion, 'release');
  assert.equal(first.error, undefined);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].scene, first.code);
  assert.equal(generated[0].page, 'projects/crun/pages/default/index/default_index');
  assert.equal(generated[0].checkPath, false, '未发布时 check_path 必须为 false，否则直接报 41030');
  assert.equal(generated[0].envVersion, 'release');
  assert.equal(uploaded[0].cloudPath, 'public/invite/crun/' + first.code + '.png');
  assert.match(first.url, /^https:\/\/cdn\.example\/qr\.png\?sign=/);

  const again = await tenant.run(A, () => service.getMyInviteQr('poster'));
  assert.equal(generated.length, 1, '同一个码不能每次打开都重新生成');
  assert.equal(again.fileID, first.fileID);
});

test('a missing release page falls back to a trial QR and keeps it for a day', async () => {
  const { f, generated, service } = await setup(data => (data.envVersion === 'release' ? 41030 : 0));
  const result = await tenant.run(A, () => service.getMyInviteQr('poster'));

  assert.equal(result.error, undefined);
  assert.equal(result.envVersion, 'trial');
  assert.equal(JSON.stringify(generated.map(item => item.envVersion)), JSON.stringify(['release', 'trial']));
  assert.ok(generated.every(item => item.checkPath === false));

  await tenant.run(A, () => service.getMyInviteQr('poster'));
  assert.equal(generated.length, 2, '体验版码在有效期内直接复用，不再请求微信');
});

test('an unavailable QR API degrades to a readable hint and never leaks the provider message', async () => {
  const { f, uploaded, service } = await setup(() => 48001);
  const result = await tenant.run(A, () => service.getMyInviteQr('poster'));

  assert.equal(result.code.length, 6);
  assert.equal(result.url, '');
  assert.match(result.error, /云调用权限/);
  assert.doesNotMatch(result.error, /openapi|fail/i);
  assert.equal(uploaded.length, 0);
});
