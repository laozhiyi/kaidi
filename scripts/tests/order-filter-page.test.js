'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { client } = require('../test-support/reliability-client.cjs');

async function orderPage() {
	const f = client(), page = f.mount('projects/crun/pages/order/index/order_index.js');
	await page.onLoad({});
	f.respond(0, { locations: {
		phases: ['一期', '静园', '图书馆'],
		pickupStations: [{ name: '雅园', list: ['中通', '圆通'] }, { name: '知园', list: ['邮政'] }]
	} });
	await page._filterLoad;
	return { f, page };
}

test('filter chips stack conditions and rebuild every tab query', async () => {
	const { page } = await orderPage();

	page.bindToggleUrgent();
	page.bindTogglePrice();
	assert.equal(page.data.filterActive, true);
	assert.deepEqual(page.data.listParams.take, { sortType: 'wait', whereEx: { 'MAIL_OBJ.urgent': true }, orderBy: { 'MAIL_OBJ.price': 'desc' } });
	// 筛选是共用的：切到「我的发布」「已完成」也带着同样的条件。
	assert.equal(page.data.listParams.posted.whereEx['MAIL_OBJ.urgent'], true);
	assert.deepEqual(page.data.listParams.done.orderBy, { 'MAIL_OBJ.price': 'desc' });
	assert.equal(page.data.listParams.mine.whereEx['MAIL_OBJ.urgent'], true);
});

test('the delivery sheet uses the same place panel as saving an address', async () => {
	const { page } = await orderPage();

	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'deliver' } } });
	assert.deepEqual(page.data.locGroups.map(group => group.title), ['宿舍区', '校内地点']);
	assert.deepEqual(page.data.locGroups[0].items[1], { label: '二期', value: '二期', name: '雅园', on: false });
	// 送达地点条目多，面板要固定高度，否则底部「已选／确定」会被挤出屏幕。
	assert.equal(page.data.locTall, true);

	// 多选：二期（宿舍区）与图书馆（校内地点）取并集。
	page.bindLocToggle({ currentTarget: { dataset: { g: 0, i: 1 } } });
	page.bindLocToggle({ currentTarget: { dataset: { g: 1, i: 1 } } });
	assert.equal(page.data.locCount, 2);
	assert.equal(page.data.locSummary, '二期、图书馆');
	page.bindLocConfirm();
	assert.equal(page.data.locSheet, '');
	assert.deepEqual(page.data.filter.deliver, ['二期', '图书馆']);
	assert.deepEqual(page.data.listParams.take.whereEx, {
		'MAIL_OBJ.addressPhase': ['in', ['二期', '雅园', '图书馆']]
	});
	assert.equal(page.data.deliverText, '2项');

	// 重新打开时选中状态保留，方便改。
	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'deliver' } } });
	assert.equal(page.data.locGroups[0].items[1].on, true);
	assert.equal(page.data.locGroups[1].items[1].on, true);
});

test('「其他」stands for orders published without a chosen place', async () => {
	const { page } = await orderPage();

	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'deliver' } } });
	page.bindLocToggleOther();
	assert.equal(page.data.locOther, true);
	assert.equal(page.data.locSummary, '其他');
	page.bindLocConfirm();
	assert.deepEqual(page.data.listParams.take.whereEx, { 'MAIL_OBJ.addressPhaseEmpty': true });
	assert.equal(page.data.deliverText, '其他');

	// 地点 + 其他：两个条件都是「或」，同时生效。
	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'deliver' } } });
	page.bindLocToggle({ currentTarget: { dataset: { g: 1, i: 0 } } });
	page.bindLocConfirm();
	assert.deepEqual(page.data.listParams.take.whereEx, {
		'MAIL_OBJ.addressPhase': ['in', ['静园']],
		'MAIL_OBJ.addressPhaseEmpty': true
	});
	assert.equal(page.data.deliverText, '2项');
});

test('pickup places reuse the «常用快递点» panel and stack with delivery places', async () => {
	const { page } = await orderPage();

	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'pickup' } } });
	// 快递点是一级分组，快递公司只出现在自己那个快递点下面。
	assert.deepEqual(page.data.locGroups.map(group => group.title), ['雅园', '知园']);
	assert.deepEqual(page.data.locGroups[0].items.map(item => item.label), ['中通', '圆通']);
	assert.deepEqual(page.data.locGroups[1].items.map(item => item.label), ['邮政']);
	// 取件地点没有「其他」这一项。
	assert.equal(page.data.locOther, false);
	// 快递点少的时候面板贴着内容，不留一大片空白。
	assert.equal(page.data.locTall, false);
	page.bindLocToggle({ currentTarget: { dataset: { g: 0, i: 0 } } });
	assert.equal(page.data.locSummary, '雅园 · 中通');
	page.bindLocConfirm();
	assert.deepEqual(page.data.listParams.take.whereEx['MAIL_OBJ.pickupPoint'], ['like', ['雅园 · 中通', '二期 · 中通']]);
	assert.equal(page.data.pickupText, '雅园 · 中通');

	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'deliver' } } });
	page.bindLocToggle({ currentTarget: { dataset: { g: 0, i: 0 } } });
	page.bindLocConfirm();
	assert.deepEqual(page.data.listParams.take.whereEx, {
		'MAIL_OBJ.pickupPoint': ['like', ['雅园 · 中通', '二期 · 中通']],
		'MAIL_OBJ.addressPhase': ['in', ['一期', '怡园']]
	});
	assert.equal(page.data.filterActive, true);
});

test('clearing every condition restores the untouched tab queries', async () => {
	const { page } = await orderPage();
	page.bindToggleUrgent();
	page.bindTogglePrice();
	page.bindOpenLocSheet({ currentTarget: { dataset: { dim: 'deliver' } } });
	page.bindLocToggleOther();
	page.bindLocConfirm();
	assert.equal(page.data.filterActive, true);

	page.bindFilterReset();
	assert.equal(page.data.filterActive, false);
	assert.equal(page.data.deliverText, '');
	assert.equal(page.data.pickupText, '');
	assert.deepEqual(page.data.listParams, {
		take: { sortType: 'wait' },
		mine: { sortType: 'my_accept' },
		posted: { sortType: 'my_post' },
		done: { sortType: 'my_done' }
	});
	assert.deepEqual(page.data.filter, { price: false, urgent: false, deliver: [], deliverOther: false, pickup: [] });
});
