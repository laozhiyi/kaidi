'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, tick } = require('../test-support/reliability-client.cjs');
const pages = 'projects/crun/pages/';
const news = { _id: 'news-one', NEWS_TITLE: '已发布公告', NEWS_CATE_ID: '1', NEWS_CATE_NAME: '校园公告', NEWS_ORDER: 1,
  NEWS_ADD_TIME: '2026-09-22 08:00', NEWS_DESC: '服务时间安排', NEWS_CONTENT: [{ type: 'text', val: '今日服务正常开放。' }], NEWS_PIC: [], NEWS_FORMS: [] };
const feedback = { _id: 'feedback-one', FB_STATUS: 1, FB_TYPE: 'complain', FB_TITLE: '订单申诉', FB_CONTENT: '请核实订单情况',
  FB_ADD_TIME: 1790035200000, FB_REPLY_TIME: 1790038800000, FB_REPLY: '已核实并处理', FB_IMG_PREVIEW: [], FB_REVIEW_SCORE: 0 };
const detailCases = [
  { name: 'announcement', file: 'news/detail/news_detail.js', route: 'news/view', field: 'news', record: news, missingState: null },
  { name: 'appeal', file: 'feedback/detail/feedback_detail.js', route: 'feedback/my_detail', field: 'detail', record: feedback, missingState: true }
];
function request(f, route) {
  const call = f.calls.findLast(item => item.data.route === route);
  assert.ok(call, 'expected cloud request for ' + route);
  return call;
}
function reply(f, route, data) { request(f, route).success({ result: { code: 200, data } }); }
function disconnect(f, route) { request(f, route).fail({ errMsg: 'network disconnected' }); }
function openDetail(f, row) { const page = f.mount(pages + row.file); page.onLoad({ id: row.record._id }); return page; }

// These run the real cloud helper, so its legacy null-on-error behavior cannot
// be accidentally replaced by a mock that throws directly into the page.
for (const row of detailCases) {
  test(row.name + ' initial network failure offers retry instead of reporting a missing record', async () => {
    const f = client(), page = openDetail(f, row), first = page.onShow();
    await tick(); disconnect(f, row.route); await first;
    assert.equal(page.data.error, true);
    assert.equal(page.data[row.field], null);
    assert.equal(page.data.isLoad, false);
    const retry = page._loadDetail(); await tick(); reply(f, row.route, row.record); await retry;
    assert.equal(page.data.error, false);
    assert.equal(page.data[row.field]._id, row.record._id);
    page.onUnload();
  });

  test(row.name + ' retains confirmed detail through a failed refresh and updates after retry', async () => {
    const f = client(), page = openDetail(f, row), first = page.onShow();
    await tick(); reply(f, row.route, row.record); await first;
    const confirmed = structuredClone(page.data[row.field]);
    const refresh = page.onPullDownRefresh(); await tick(); disconnect(f, row.route); await refresh;
    assert.deepEqual(page.data[row.field], confirmed);
    assert.equal(page.data.isLoad, true);
    assert.equal(page.data.error, true);
    const retry = page._loadDetail(); await tick(); reply(f, row.route, { ...row.record, _id: 'updated-record' }); await retry;
    assert.equal(page.data[row.field]._id, 'updated-record');
    assert.equal(page.data.error, false);
    page.onUnload();
  });

  test(row.name + ' distinguishes a confirmed missing record from a transport failure', async () => {
    for (const response of [null, {}]) {
      const f = client(), page = openDetail(f, row), first = page.onShow();
      await tick(); reply(f, row.route, response); await first;
      assert.equal(page.data[row.field], null);
      assert.equal(page.data.isLoad, row.missingState);
      assert.equal(page.data.error, false);
      assert.equal(f.calls.filter(call => call.data.route === 'operations/read').length, 0);
      page.onUnload();
    }
  });

  test(row.name + ' ignores a request completed after the page is unloaded', async () => {
    const f = client(), page = openDetail(f, row), pending = page.onShow();
    await tick(); page.onUnload(); const patches = page.patches.length;
    reply(f, row.route, row.record); await pending;
    assert.equal(page.patches.length, patches);
    assert.equal(f.calls.filter(call => call.data.route === 'operations/read').length, 0);
  });
}

test('an appeal that is confirmed deleted clears the previous record', async () => {
  const row = detailCases[1], f = client(), page = openDetail(f, row), first = page.onShow();
  await tick(); reply(f, row.route, row.record); await first;
  const refresh = page._loadDetail(); await tick();
  request(f, row.route).success({ result: { code: 1600, msg: '反馈不存在' } }); await refresh;
  assert.equal(page.data.detail, null); assert.equal(page.data.isLoad, true); assert.equal(page.data.error, false);
  page.onUnload();
});

test('about content survives a network failure instead of becoming unconfigured fallback text', async () => {
  const f = client(), page = f.mount(pages + 'about/index/about_index.js');
  const content = [{ type: 'text', val: '已配置的运营联系电话：12345' }];
  let load = page.load(); await tick(); reply(f, 'home/setup_get', content); await load;
  load = page.onPullDownRefresh(); await tick(); disconnect(f, 'home/setup_get'); await load;
  assert.deepEqual(page.data.about, content); assert.equal(page.data.error, true); assert.equal(page.data.loading, false);
  load = page.load(); await tick(); reply(f, 'home/setup_get', []); await load;
  assert.deepEqual(page.data.about, []); assert.equal(page.data.error, false);
  page.onUnload();
});

test('admin announcement refresh failures preserve the visible form and its unsaved draft', async () => {
  const f = client({ admin: true }), page = f.mount(pages + 'admin/news/edit/admin_news_edit.js', { id: news._id });
  let load = page._loadDetail(); await tick(); reply(f, 'admin/news_detail', news); await load;
  page.setData({ formTitle: '尚未保存的公告标题', formContent: [{ type: 'text', val: '尚未保存的正文' }] });
  for (let i = 0; i < 2; i++) {
    load = page._loadDetail(); await tick(); disconnect(f, 'admin/news_detail'); await load;
    assert.equal(page.data.formTitle, '尚未保存的公告标题');
    assert.equal(page.data.formContent[0].val, '尚未保存的正文');
    assert.equal(page.data.isLoad, true); assert.ok(page.data.loadError); assert.equal(page.data.loading, false);
  }
  page.onUnload();
});

test('admin announcement initial failure retries, missing records terminate and unload ignores a late response', async () => {
  const f = client({ admin: true }), page = f.mount(pages + 'admin/news/edit/admin_news_edit.js', { id: news._id });
  let load = page._loadDetail(); await tick(); disconnect(f, 'admin/news_detail'); await load;
  assert.equal(page.data.isLoad, false); assert.ok(page.data.loadError);
  load = page._loadDetail(); await tick(); reply(f, 'admin/news_detail', null); await load;
  assert.equal(page.data.isLoad, null); assert.equal(page.data.loadError, '');
  load = page._loadDetail(); await tick(); reply(f, 'admin/news_detail', news); await load;
  assert.equal(page.data.formTitle, news.NEWS_TITLE); assert.equal(page.data.isLoad, true);
  load = page._loadDetail(); await tick(); page.onUnload(); const patches = page.patches.length;
  reply(f, 'admin/news_detail', { ...news, NEWS_TITLE: '已卸载后的旧响应' }); await load;
  assert.equal(page.patches.length, patches);
});

async function reopenInbox(f, page) {
  const start = f.calls.length, showing = page.onShow(); await tick();
  for (const call of f.calls.slice(start)) {
    const route = call.data.route;
    const data = route === 'operations/summary' ? { unreadCount: 0, featuredNews: null }
      : route === 'operations/config' ? { templateId: 'orders' } : { list: [], hasMore: false };
    call.success({ result: { code: 200, data } });
  }
  await showing;
}

test('subscription completion in the background releases its lock for the next visit', async () => {
  const f = client(), page = f.mount(pages + 'operations/operations.js', { config: { templateId: 'orders' } }), prompts = [];
  f.wx.requestSubscribeMessage = callbacks => prompts.push(callbacks);
  page._visible = true;
  let pending = page.bindSubscribe(); assert.equal(prompts.length, 1);
  page.onHide(); prompts[0].success({ orders: 'accept' }); await tick();
  reply(f, 'operations/subscribe', { ok: true }); await pending;
  assert.equal(page.data.subscribing, false);
  assert.equal(f.ui.filter(row => row[0] === 'toast').length, 0);
  await reopenInbox(f, page);
  pending = page.bindSubscribe(); assert.equal(prompts.length, 2);
  prompts[1].success({ orders: 'reject' }); await pending;
  assert.equal(page.data.subscribing, false);
  page.onUnload();
});

test('subscription completion after unload cannot write page state or show a toast', async () => {
  const f = client(), page = f.mount(pages + 'operations/operations.js', { config: { templateId: 'orders' } });
  let prompt; f.wx.requestSubscribeMessage = callbacks => { prompt = callbacks; };
  page._visible = true; const pending = page.bindSubscribe();
  prompt.success({ orders: 'accept' }); await tick(); page.onUnload(); const patches = page.patches.length;
  reply(f, 'operations/subscribe', { ok: true }); await pending;
  assert.equal(page.patches.length, patches);
  assert.equal(f.ui.filter(row => row[0] === 'toast').length, 0);
});
