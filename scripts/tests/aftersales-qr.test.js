'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../test-support/admin-console-harness.cjs');

const page = 'settings/aftersales/admin_aftersales_settings.js';
const KEY = 'SETUP_CONTENT_AFTERSALES';
// 页面代码跑在独立的 vm 上下文里，跨 realm 的数组要转成本地对象再比。
const plain = value => JSON.parse(JSON.stringify(value));

test('售后群二维码页只对管理员和超管开放，客服与过期会话打不开也不发请求', async () => {
	const h = harness(page, () => [], { denied: true });
	await h.page.onLoad();
	await h.page.bindChoose();
	await h.page.bindReset();
	assert.equal(h.calls.length, 0);
	assert.equal(h.navigation.length, 0);
});

test('页面读出现有二维码；没配置时显示内置兜底而不是空白', async () => {
	const configured = harness(page, () => [{ type: 'text', val: '群号 123456' }, { type: 'img', val: 'cloud://old.png' }]);
	await configured.page.onLoad();
	assert.equal(configured.calls[0].route, 'home/setup_get');
	assert.equal(configured.calls[0].params.key, KEY);
	assert.equal(configured.page.data.qrUrl, 'cloud://old.png');
	assert.equal(configured.page.data.isLoad, true);

	const empty = harness(page, () => []);
	await empty.page.onLoad();
	assert.equal(empty.page.data.qrUrl, '');
	assert.equal(empty.page.data.fallbackQr, '/projects/crun/images/aftersales_qr.jpg');

	const failed = harness(page, () => { throw Error('网络连接失败'); });
	await failed.page.onLoad();
	assert.match(failed.page.data.error, /网络连接失败/);
	assert.equal(failed.page.data.loading, false);
});

test('上传新二维码只替换图片节点，群说明和管理员刚改的文字都不受影响', async () => {
	const h = harness(page, () => [{ type: 'text', val: '群号 123456' }, { type: 'img', val: 'cloud://old.png' }], { uploadResult: 'cloud://new.png' });
	await h.page.onLoad();
	await h.page.bindChoose();
	assert.equal(h.events.find(item => item.upload).upload, 'wxfile://tmp/qr.png');
	const save = h.calls.find(call => call.route === 'admin/setup_set_content');
	assert.equal(save.params.id, KEY);
	assert.deepEqual(plain(save.params.content), [{ type: 'text', val: '群号 123456' }, { type: 'img', val: 'cloud://new.png' }]);
	assert.equal(h.page.data.qrUrl, 'cloud://new.png');
	assert.equal(h.page.data.busy, false);
	assert.equal(h.page.data.qrBusy, false);
});

test('取消选图不会上传也不会写库', async () => {
	const h = harness(page, () => [{ type: 'img', val: 'cloud://old.png' }], { mediaCancelled: true });
	await h.page.onLoad();
	const before = h.calls.length;
	await h.page.bindChoose();
	assert.equal(h.calls.length, before);
	assert.equal(h.events.filter(item => item.upload).length, 0);
});

test('移除二维码后回落到内置图，只留文字；没有文字时仍提交合法内容', async () => {
	const h = harness(page, () => [{ type: 'text', val: '群号 123456' }, { type: 'img', val: 'cloud://old.png' }]);
	await h.page.onLoad();
	await h.page.bindReset();
	const save = h.calls.find(call => call.route === 'admin/setup_set_content');
	assert.deepEqual(plain(save.params.content), [{ type: 'text', val: '群号 123456' }]);
	assert.equal(h.page.data.qrUrl, '');

	const onlyQr = harness(page, () => [{ type: 'img', val: 'cloud://only.png' }]);
	await onlyQr.page.onLoad();
	await onlyQr.page.bindReset();
	assert.deepEqual(plain(onlyQr.calls.find(call => call.route === 'admin/setup_set_content').params.content), [{ type: 'text', val: '' }]);

	const none = harness(page, () => []);
	await none.page.onLoad();
	const before = none.calls.length;
	await none.page.bindReset();
	assert.equal(none.calls.length, before, '没有二维码时移除按钮不应写库');
});

test('管理中心和关于与联系都能进到这个页面', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const root = path.resolve(__dirname, '../..');
	const routes = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/biz/admin_console_biz.js'), 'utf8');
	assert.match(routes, /aftersales: '\/projects\/crun\/pages\/admin\/settings\/aftersales\/admin_aftersales_settings'/);
	const settings = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/admin/settings/index/admin_settings.js'), 'utf8');
	assert.match(settings, /key: 'aftersales'/);
	const aboutList = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/admin/setup/about_list/admin_setup_about_list.wxml'), 'utf8');
	assert.match(aboutList, /settings\/aftersales\/admin_aftersales_settings/);
});
