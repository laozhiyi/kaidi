'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = path.resolve(__dirname, '../../miniprogram/helper/content_check_helper.js');

// 在独立上下文里加载真实 helper，wx 由用例注入。
function load(wx) {
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
		module, exports: module.exports, wx,
		console: { log() {}, warn() {}, error() {} },
		require: () => ({})
	}, { filename: file });
	return module.exports;
}

function market(invokeService) {
	return { serviceMarket: { invokeService, CDN: class CDN { constructor(options) { this.options = options; } } } };
}

const PASS = {
	PornResult: { Suggestion: 'PASS' },
	PoliticsResult: { Suggestion: 'PASS' },
	TerrorismResult: { Suggestion: 'PASS' }
};

test('内容安全服务不可用时返回 null，而不是当成违规把图片拦下来', async () => {
	// 没有 wx.serviceMarket（低版本基础库 / 非小程序环境）
	assert.equal(await load({}).imgCheck('wxfile://tmp/qr.png'), null);

	// 服务未订阅、余额不足、网络异常都会走到 reject
	const rejected = load(market(async () => { throw new Error('errno 101: 服务未开通'); }));
	assert.equal(await rejected.imgCheck('wxfile://tmp/qr.png'), null);

	// 调用成功但没有 Response 字段，同样无法判定
	const empty = load(market(async () => ({ data: {} })));
	assert.equal(await empty.imgCheck('wxfile://tmp/qr.png'), null);
});

test('三项都 PASS 才放行，任一项 BLOCK 拦截，待复审放行并留痕', async () => {
	const pass = load(market(async () => ({ data: { Response: PASS } })));
	assert.equal(await pass.imgCheck('wxfile://tmp/qr.png'), true);

	const blocked = { ...PASS, PoliticsResult: { Suggestion: 'BLOCK' } };
	const block = load(market(async () => ({ data: { Response: blocked } })));
	assert.equal(await block.imgCheck('wxfile://tmp/qr.png'), false);

	const review = { ...PASS, PornResult: { Suggestion: 'REVIEW' } };
	const pending = load(market(async () => ({ data: { Response: review } })));
	assert.equal(await pending.imgCheck('wxfile://tmp/qr.png'), null);
});
