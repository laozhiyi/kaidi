'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, tick } = require('../test-support/reliability-client.cjs');
const list = ids => ({ page: 1, size: 20, total: ids.length, count: 1, hasMore: false, list: ids.map(_id => ({ _id, MAIL_OBJ: {}, MAIL_FAV_CNT: 0 })) });

test('simultaneous reads share one request, isolate identities, and return independent DTOs', async () => {
  const f = client();
  const first = f.cloud.callCloud('mail/list', { page: 1, sortType: 'wait' }, { hint: false });
  const second = f.cloud.callCloud('mail/list', { sortType: 'wait', page: 1 }, { hint: false });
  assert.equal(f.calls.length, 1);
  f.setUser('another-user');
  const other = f.cloud.callCloud('mail/list', { page: 1, sortType: 'wait' }, { hint: false });
  assert.equal(f.calls.length, 2);
  f.respond(0, list(['one'])); f.respond(1, list(['other']));
  const [a, b, c] = await Promise.all([first, second, other]);
  a.data.list[0]._id = 'changed'; assert.equal(b.data.list[0]._id, 'one'); assert.equal(c.data.list[0]._id, 'other');
});

test('timeouts, malformed responses and both login redirects settle their promises and release loading state', async () => {
  const f = client();
  const timeout = assert.rejects(f.cloud.callCloud('mail/view', { id: 'one' }, { timeoutMs: 1000 }), error => error.retryable === true);
  await f.advance(1000); await timeout;
  f.respond(0, { _id: 'late' }); assert.equal(f.ui.filter(row => row[0] === 'hide').length, 1);
  for (const code of [2401, 2501]) {
    const promise = assert.rejects(f.cloud.callCloud('admin/home', {}, { hint: false }), error => error.code === code);
    f.respond(f.calls.length - 1, {}, code); await promise;
  }
  const invalid = assert.rejects(f.cloud.callCloud('mail/view', {}, { hint: false }), error => error.retryable === true);
  f.calls.at(-1).success({}); await invalid;
  assert.equal(f.timers.size, 0);
});

test('overlapping visible requests do not dismiss each other’s loading indicator', async () => {
  const f = client(), a = f.cloud.callCloud('mail/view', { id: 'a' }), b = f.cloud.callCloud('mail/view', { id: 'b' });
  f.respond(0, {}); await a; assert.equal(f.ui.filter(row => row[0] === 'hide').length, 0);
  f.respond(1, {}); await b; assert.equal(f.ui.filter(row => row[0] === 'hide').length, 1);
  assert.equal(f.ui[0][1].mask, false);
});

test('repeated command taps and a lost reply retry with the same persistent request id', async () => {
  const f = client(), ops = f.ops();
  const jobs = Array.from({ length: 30 }, () => ops.command('mail/accept', { id: 'order' }, { retries: 1 }));
  await tick(); assert.equal(f.calls.length, 1);
  const requestId = f.calls[0].data.params.requestId;
  f.fail(0); await tick(); await f.advance(600);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].data.params.requestId, requestId);
  f.respond(1, { id: 'order' }); await Promise.all(jobs);
  assert.equal(f.storage.size, 0);
});

test('unknown submission results cannot be replaced with changed content, but confirmed business errors allow correction', async () => {
  const f = client(), ops = f.ops(), original = { forms: [{ mark: 'title', val: 'first' }] };
  const failed = assert.rejects(ops.command('mail/insert', original, { retries: 0 }));
  await tick(); f.fail(0); await failed;
  await assert.rejects(ops.command('mail/insert', { forms: [] }), /尚未确认/);
  assert.equal(f.calls.length, 1);
  const recovered = ops.command('mail/insert', original); await tick();
  assert.equal(f.calls[1].data.params.requestId, f.calls[0].data.params.requestId);
  f.respond(1, { _id: 'saved' }); await recovered;
  const rejected = assert.rejects(ops.command('mail/insert', original)); await tick(); f.respond(2, {}, 1600); await rejected;
  const corrected = ops.command('mail/insert', { forms: [] }); await tick(); f.respond(3, { _id: 'corrected' }); await corrected;
});

test('changing filters rejects an older response and a failed refresh preserves the last confirmed list', async () => {
  const f = client(), component = f.mount('cmpts/public/list/comm_list_cmpt.js', { route: 'mail/list', type: 'orders', _params: { sortType: 'wait' } });
  const old = component._getList(1);
  component.data._params = { sortType: 'my_post' };
  const current = component._getList(1);
  f.respond(1, list(['new-filter'])); await current;
  f.respond(0, list(['old-filter'])); await old;
  assert.equal(component.data._dataList.list[0]._id, 'new-filter');
  const refresh = component.refresh(); f.fail(2); await refresh;
  assert.equal(component.data._dataList.list[0]._id, 'new-filter'); assert.equal(component.data._dataList.error, true);
  assert.ok(component.data.listError); assert.equal(component.data.listLoading, false);
});

test('a component hidden during a request emits no stale list and does not cache a failed load', async () => {
  const f = client(), component = f.mount('cmpts/public/list/comm_list_cmpt.js', { route: 'mail/list', type: 'orders' });
  const load = component._getList(1); const before = f.events.length;
  component.pageLifetimes.hide.call(component);
  f.respond(0, list(['hidden'])); await load;
  assert.equal(f.events.length, before); assert.equal(f.cached.has('orders'), false);
  component._pageVisible = true;
  const retry = component._getList(1); f.fail(1); await retry;
  assert.equal(component.data._dataList.error, true); assert.equal(f.cached.has('orders'), false);
});

test('live signals refresh the available-order page automatically while preserving its filters', async () => {
  const f = client(), page = f.mount('projects/crun/pages/order/index/order_index.js');
  const component = f.mount('cmpts/public/list/comm_list_cmpt.js', { route: 'mail/list', type: 'order-mail-take', _params: { sortType: 'wait', whereEx: { 'MAIL_OBJ.urgent': true } } });
  page.selectComponent = () => component; component.listener = event => page.bindCommListCmpt(event);
  await page.onLoad({}); page.onShow();
  const initial = component._getList(1); f.respond(0, list([])); await initial;
  f.watchers[0].onChange({ docs: [{ _id: 'crun_0', revision: 'published' }] });
  await f.advance(250);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].data.params.whereEx['MAIL_OBJ.urgent'], true);
  f.respond(1, list(['new-order'])); await tick();
  assert.equal(page.data.dataList.list[0]._id, 'new-order');
  assert.equal(f.watchers[0].name, 'bx_order_feed'); assert.equal(f.watchers[0].limit, 64);
  page.onHide(); assert.equal(f.watchers[0].closed, true); assert.equal(f.network.size, 0);
  const count = f.calls.length; await f.advance(60000); assert.equal(f.calls.length, count);
});

test('signal bursts coalesce, changes during a refresh are not lost, and hidden callbacks cannot restart polling', async () => {
  const f = client(); let resolve, loads = 0;
  const first = new Promise(done => { resolve = done; });
  const stop = f.sync().subscribe(() => { loads++; return loads === 1 ? first : Promise.resolve(); });
  const watch = f.watchers[0];
  for (let i = 0; i < 100; i++) watch.onChange({ docs: [{ _id: 'crun_1', revision: String(i) }] });
  await f.advance(250); assert.equal(loads, 1);
  watch.onChange({ docs: [{ _id: 'crun_1', revision: 'later' }] });
  resolve(); await tick(); await f.advance(1600); assert.equal(loads, 2);
  stop(); watch.onChange({ docs: [{ _id: 'crun_1', revision: 'hidden' }] }); await f.advance(60000);
  assert.equal(loads, 2); assert.equal(f.timers.size, 0);
});

test('watch failures fall back to polling and reconnect; offline/background periods issue no reads', async () => {
  const f = client(); let loads = 0;
  const sync = f.sync(), stop = sync.subscribe(async () => { loads++; });
  f.watchers[0].onError(new Error('permission not configured'));
  await f.advance(1200); assert.equal(f.watchers.length, 2);
  f.watchers[0].onChange({ docs: [{ _id: 'late', revision: 'stale' }] }); await f.advance(250); assert.equal(loads, 0);
  await f.advance(10000); assert.ok(loads > 0);
  f.networkChange(false); const before = loads; await f.advance(60000); assert.equal(loads, before);
  f.networkChange(true); await f.advance(1600); assert.ok(loads > before);
  sync.pause(); const paused = loads; await f.advance(60000); assert.equal(loads, paused);
  sync.resume(); await f.advance(1600); assert.ok(loads > paused); stop();
});

test('image upload failure preserves every original path and a retry only uploads the failed image', async () => {
  const f = client(); let fail = true; const uploads = [];
  f.wx.cloud.uploadFile = async options => {
    uploads.push(options);
    if (options.filePath.endsWith('bad.jpg') && fail) throw Error('offline');
    return { fileID: 'cloud://stored/' + options.filePath.split('/').at(-1) };
  };
  const paths = ['wxfile://tmp/good.jpg', 'wxfile://tmp/bad.jpg'];
  await assert.rejects(f.cloud.transTempPics(paths, 'orders/'), /上传失败/);
  assert.equal(paths.length, 2); assert.equal(paths[0], 'cloud://stored/good.jpg'); assert.equal(paths[1], 'wxfile://tmp/bad.jpg');
  fail = false; await f.cloud.transTempPics(paths, 'orders/'); assert.equal(uploads.length, 3);
  assert.equal(paths[1], 'cloud://stored/bad.jpg');
});

test('switching order tabs shows that tab’s recent snapshot immediately without crossing user identities', async () => {
  const f = client(), page = f.mount('projects/crun/pages/order/index/order_index.js');
  await page.onLoad({}); page.onShow();
  page.bindCommListCmpt({ detail: { dataList: list(['available']) } });
  page.bindTabTap({ currentTarget: { dataset: { idx: 1 } } });
  assert.equal(page.data.dataList, null);
  page.bindCommListCmpt({ detail: { dataList: list(['mine']) } });
  page.bindTabTap({ currentTarget: { dataset: { idx: 0 } } });
  assert.equal(page.data.dataList.list[0]._id, 'available');
  f.setUser('new-user'); page.onShow(); assert.equal(page.data.dataList, null);
  page.bindTabTap({ currentTarget: { dataset: { idx: 1 } } }); assert.equal(page.data.dataList, null);
  page.onHide();
});

test('an automatic refresh preserves deep-scroll results and refreshes when the user returns to the top', async () => {
  const f = client(), component = f.mount('cmpts/public/list/comm_list_cmpt.js', { route: 'mail/list', _dataList: { ...list(['old']), page: 3 } });
  component.bindScrollTop({ detail: { scrollTop: 700 } });
  await component.refresh(); assert.equal(f.calls.length, 0); assert.equal(component.data.updatesPending, true);
  assert.equal(component.data._dataList.page, 3);
  component.bindScrollTop({ detail: { scrollTop: 0 } }); assert.equal(f.calls.length, 1);
  f.respond(0, list(['new'])); await tick(); assert.equal(component.data._dataList.list[0]._id, 'new');
});
