const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname,
	'../../miniprogram/projects/crun/pages/campus_service/chat/chat_page.js'), 'utf8');
const service = { CS_STATUS: 1, CS_NAME: '校区客服', CS_CAMPUS: '育才校区' };
const message = id => ({ CSM_ID: id, CSM_CONTENT: id, CSM_SENDER: 'user', CSM_ADD_TIME: id });
const result = (ids, hasMore = false, nextBefore = '') => ({
	code: 200, data: { service, messages: ids.map(message), hasMore, nextBefore }
});
const ids = page => Array.from(page.data.messages, item => item.CSM_ID);
function deferred() {
	let resolve, reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function mount(admin = false) {
	const requests = [], submits = [], modals = [], timers = new Map();
	let sequence = 0, stopped = 0;
	const cloud = {
		callCloud: async (route, params, options) => {
			requests.push({ route, params, options });
			return cloud.read(route, params, options);
		},
		callCloudSumbit: async (route, params, options) => {
			submits.push({ route, params, options });
			return cloud.send(route, params, options);
		},
		read: async () => result(['3', '4'], true, '3'),
		send: async () => ({ code: 200, data: { id: 'sent' } })
	};
	const sandbox = {
		module: { exports: {} },
		require: name => {
			if (name.endsWith('/cloud_helper.js')) return cloud;
			if (name.endsWith('/page_helper.js')) return { showModal: text => modals.push(text) };
			throw new Error('Unexpected dependency ' + name);
		},
		wx: { stopPullDownRefresh: () => { stopped++; } },
		setTimeout: (callback, ms) => { const key = ++sequence; timers.set(key, { callback, ms }); return key; },
		clearTimeout: key => timers.delete(key)
	};
	vm.runInNewContext(source, sandbox, { filename: 'chat_page.js' });
	const config = admin ? {
		idKey: 'sessionId', ownSender: 'admin', getRoute: 'admin/campus_chat_detail', sendRoute: 'admin/campus_chat_reply'
	} : {
		idKey: 'serviceId', ownSender: 'user', getRoute: 'campus_service/chat', sendRoute: 'campus_service/send'
	};
	const page = sandbox.module.exports({ ...config, init: () => true });
	page.data = JSON.parse(JSON.stringify(page.data));
	page.patches = [];
	page.setData = (patch, callback) => {
		page.patches.push(patch);
		Object.assign(page.data, patch);
		if (callback) callback();
	};
	page._measureMessages = async () => ({ height: 200, top: 60 });
	page.onLoad({ [config.idKey]: 'conversation-id' });
	return {
		page, cloud, requests, submits, modals, timers,
		stopped: () => stopped,
		show: async () => { page.onShow(); await page._request; },
		tick: async () => {
			const [key, timer] = timers.entries().next().value;
			timers.delete(key);
			assert.equal(timer.ms, 6000);
			timer.callback();
			await page._request;
		}
	};
}

for (const admin of [false, true]) {
	test((admin ? 'admin' : 'user') + ' chat loads its endpoint and sends the correct identity', async () => {
		const h = mount(admin);
		await h.show();
		assert.deepEqual(ids(h.page), ['3', '4']);
		assert.equal(h.requests[0].route, admin ? 'admin/campus_chat_detail' : 'campus_service/chat');
		assert.equal(h.requests[0].params[admin ? 'sessionId' : 'serviceId'], 'conversation-id');
		assert.equal(h.requests[0].params.limit, 50);
		assert.equal(h.requests[0].options.hint, false);
		assert.equal(h.page.data.nextBefore, '3');
		assert.equal(h.page.data.scrollIntoView, 'messages-bottom');
		h.page.bindContentInput({ detail: { value: '  测试消息  ' } });
		await h.page.bindSendTap();
		assert.equal(h.submits[0].route, admin ? 'admin/campus_chat_reply' : 'campus_service/send');
		assert.equal(h.submits[0].params.content, '测试消息');
		assert.equal(h.submits[0].params[admin ? 'sessionId' : 'serviceId'], 'conversation-id');
		assert.equal(h.page.data.content, '');
		assert.equal(h.page.data.isSending, false);
		h.page.onUnload();
		assert.equal(h.timers.size, 0);
	});
}

test('earlier pages use CSM_ID cursors, prepend once, and preserve viewport position', async () => {
	const h = mount();
	await h.show();
	let measure = 0;
	h.page._measureMessages = async () => (++measure === 1 ? { height: 200, top: 60 } : { height: 500, top: 60 });
	h.cloud.read = async (route, params) => {
		assert.equal(params.before, '3');
		return result(['1', '2'], false);
	};
	await h.page.bindEarlierTap();
	assert.deepEqual(ids(h.page), ['1', '2', '3', '4']);
	assert.equal(h.page.data.scrollTop, 360);
	assert.equal(h.page.data.scrollIntoView, '');
	assert.equal(h.page.data.hasMore, false);
	assert.equal(h.page.data.loadingEarlier, false);
	const count = h.requests.length;
	await h.page.bindEarlierTap();
	assert.equal(h.requests.length, count);
});

test('quiet refresh retains history, does not steal scroll, and avoids unchanged message patches', async () => {
	const h = mount();
	await h.show();
	h.page._nearBottom = false;
	h.page.setData({ scrollIntoView: '' });
	h.cloud.read = async () => result(['4', '5'], true, '4');
	await h.tick();
	assert.deepEqual(ids(h.page), ['3', '4', '5']);
	assert.equal(h.page.data.scrollIntoView, '');
	assert.equal(h.page.data.hasNewMessages, true);
	assert.equal(h.page.data.nextBefore, '3');
	assert.ok(h.requests.every(item => item.options.hint === false));
	h.page.patches.length = 0;
	await h.tick();
	assert.equal(h.page.patches.some(patch => Object.hasOwn(patch, 'messages')), false);
	h.page.bindLatestTap();
	assert.equal(h.page.data.hasNewMessages, false);
	assert.equal(h.page.data.scrollIntoView, 'messages-bottom');
});

test('refresh catches up multiple cursor pages without dropping intervening messages', async () => {
	const h = mount();
	await h.show();
	h.cloud.read = async (route, params) => {
		if (!params.before) return result(['9', '10'], true, '9');
		if (params.before === '9') return result(['7', '8'], true, '7');
		if (params.before === '7') return result(['5', '6'], true, '5');
		assert.equal(params.before, '5');
		return result(['3', '4'], true, '3');
	};
	await h.page.bindRefreshTap();
	assert.deepEqual(ids(h.page), ['3', '4', '5', '6', '7', '8', '9', '10']);
	assert.equal(h.page.data.nextBefore, '3');
});

test('refresh and earlier-page failures preserve messages and reset loading flags', async () => {
	const h = mount();
	await h.show();
	h.cloud.read = async () => { throw new Error('offline'); };
	await h.page.onPullDownRefresh();
	assert.deepEqual(ids(h.page), ['3', '4']);
	assert.equal(h.stopped(), 1);
	assert.ok(h.page.data.errorText);
	assert.equal(h.page.data.loading, false);
	await h.page.bindEarlierTap();
	assert.ok(h.page.data.historyError);
	assert.equal(h.page.data.loadingEarlier, false);
	assert.equal(h.page.data.nextBefore, '3');
	assert.deepEqual(ids(h.page), ['3', '4']);
	assert.equal(h.modals.length, 0);
	assert.equal(h.timers.size, 1);
});

test('hide cancels timers and discards late responses, show starts a fresh request', async () => {
	const h = mount();
	await h.show();
	assert.equal(h.timers.size, 1);
	const old = deferred();
	h.cloud.read = () => old.promise;
	const pending = h.page.bindRefreshTap();
	h.page.onHide();
	assert.equal(h.timers.size, 0);
	assert.equal(h.page.data.loading, false);
	h.cloud.read = async () => result(['4', '5']);
	await h.show();
	old.resolve(result(['stale']));
	await pending;
	assert.deepEqual(ids(h.page), ['3', '4', '5']);
	assert.equal(h.timers.size, 1);
	h.page.onHide();
	const count = h.requests.length;
	await h.page.bindRefreshTap();
	assert.equal(h.requests.length, count);
});

test('unload ignores in-flight responses without changing detached page data', async () => {
	const h = mount();
	const wait = deferred();
	h.cloud.read = () => wait.promise;
	h.page.onShow();
	const pending = h.page._request;
	h.page.onUnload();
	h.page.patches.length = 0;
	wait.resolve(result(['late']));
	await pending;
	assert.equal(h.page.patches.length, 0);
	assert.equal(h.timers.size, 0);
});

test('send guards duplicate taps and preserves edits made while the request is pending', async () => {
	const h = mount();
	await h.show();
	const send = deferred();
	h.cloud.send = () => send.promise;
	h.page.bindContentInput({ detail: { value: '发送原文' } });
	const pending = h.page.bindSendTap();
	assert.equal(h.page.data.isSending, true);
	assert.equal(h.timers.size, 0);
	await h.page.bindSendTap();
	assert.equal(h.submits.length, 1);
	h.page.bindContentInput({ detail: { value: '下一条草稿' } });
	send.resolve({ code: 200 });
	await pending;
	assert.equal(h.page.data.content, '下一条草稿');
	assert.equal(h.page.data.isSending, false);
	assert.equal(h.timers.size, 1);
});

test('send preserves a retyped identical draft and keeps failed-send content', async () => {
	const h = mount();
	await h.show();
	const send = deferred();
	h.cloud.send = () => send.promise;
	h.page.bindContentInput({ detail: { value: '原文' } });
	const pending = h.page.bindSendTap();
	h.page.bindContentInput({ detail: { value: '' } });
	h.page.bindContentInput({ detail: { value: '原文' } });
	send.resolve({ code: 200 });
	await pending;
	assert.equal(h.page.data.content, '原文');
	h.cloud.send = async () => { throw { msg: '网络不可用' }; };
	await h.page.bindSendTap();
	assert.equal(h.page.data.content, '原文');
	assert.equal(h.modals.at(-1), '网络不可用');
	assert.equal(h.page.data.isSending, false);
});

test('send completing while hidden does not restart polling or fetch messages', async () => {
	const h = mount();
	await h.show();
	const send = deferred();
	h.cloud.send = () => send.promise;
	h.page.bindContentInput({ detail: { value: '原文' } });
	const pending = h.page.bindSendTap();
	h.page.onHide();
	const count = h.requests.length;
	send.resolve({ code: 200 });
	await pending;
	assert.equal(h.requests.length, count);
	assert.equal(h.timers.size, 0);
	assert.equal(h.page.data.isSending, false);
});
