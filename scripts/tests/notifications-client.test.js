'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, tick, deferred } = require('../test-support/notification-client-harness.cjs');
const event = id => ({ currentTarget: { dataset: { id } } });
const callsFor = (h, route) => h.calls.filter(call => call.route === route);

test('all entry badges share one request and one 60 second timer, and backgrounding stops polling', async () => {
  const h = harness(), api = h.notifications(), a = [], b = [];
  const stopA = api.subscribe(value => a.push(value)), stopB = api.subscribe(value => b.push(value));
  await tick(); assert.equal(callsFor(h, 'operations/summary').length, 1);
  assert.equal(a.at(-1).badge, '3'); assert.equal(b.at(-1).badge, '3');
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 60000);
  h.responses['operations/summary'] = { ...h.summary, unreadCount: 108 };
  await h.fireTimer(); assert.equal(a.at(-1).badge, '99+');
  api.pause(); assert.equal(h.timers.size, 0);
  api.resume(); await tick(); assert.equal(h.timers.size, 1);
  stopA(); stopB(); assert.equal(h.timers.size, 0);
});

test('failed refresh retains the last confirmed count and a late response cannot leak another identity', async () => {
  const h = harness(), api = h.notifications(); await api.refresh(true);
  h.responses['operations/summary'] = () => { throw Error('offline'); };
  await api.refresh(true); assert.equal(api.snapshot().unreadCount, 3); assert.equal(api.snapshot().error, true);
  const pending = deferred(); h.responses['operations/summary'] = () => pending.promise;
  const old = api.refresh(true);
  h.setUser(''); h.responses['news/featured'] = { featuredNews: null }; await api.refresh(true);
  assert.equal(api.snapshot().unreadCount, 0); assert.equal(api.snapshot().featuredNews, null);
  pending.resolve({ ...h.summary, unreadCount: 99 }); await old;
  assert.equal(api.snapshot().unreadCount, 0); assert.equal(api.snapshot().featuredNews, null);
});

test('read acknowledgements coalesce and a stale count cannot overwrite the refreshed badge', async () => {
  const h = harness(), api = h.notifications(); await api.refresh(true);
  const oldCount = deferred(), ack = deferred(); h.responses['operations/summary'] = () => oldCount.promise;
  const stale = api.refresh(true);
  h.responses['operations/read'] = () => ack.promise;
  const first = api.markRead('news', 'news'), second = api.markRead('news', 'news');
  assert.equal(callsFor(h, 'operations/read').length, 1);
  h.responses['operations/summary'] = { ...h.summary, unreadCount: 2 };
  ack.resolve({ ok: true }); await Promise.all([first, second]);
  oldCount.resolve(h.summary); await stale;
  assert.equal(api.snapshot().unreadCount, 2);
  await api.markRead('news', 'news'); assert.equal(callsFor(h, 'operations/read').length, 1);
});

test('acknowledgements completed in the background refresh only after returning to the app', async () => {
  for (const route of ['operations/read', 'operations/read_all']) {
    const h = harness(), api = h.notifications(), ack = deferred();
    const stop = api.subscribe(() => {}); await tick();
    h.responses[route] = () => ack.promise;
    const pending = route === 'operations/read' ? api.markRead('news', 'news') : api.markAllRead();
    api.pause();
    h.responses['operations/summary'] = { ...h.summary, unreadCount: 2 };
    ack.resolve({ ok: true }); await pending;
    assert.equal(callsFor(h, 'operations/summary').length, 1);
    assert.equal(h.timers.size, 0);
    api.resume(); await tick();
    assert.equal(callsFor(h, 'operations/summary').length, 2);
    assert.equal(api.snapshot().unreadCount, 2);
    stop(); assert.equal(h.timers.size, 0);
  }
});

test('failed reads retain unread state and can be retried', async () => {
  const h = harness(), api = h.notifications(); await api.refresh(true);
  h.responses['operations/read'] = () => { throw Error('offline'); };
  await assert.rejects(api.markRead('news', 'news'), /offline/);
  assert.equal(api.snapshot().unreadCount, 3);
  h.responses['operations/read'] = { ok: true }; h.responses['operations/summary'] = { ...h.summary, unreadCount: 2 };
  await api.markRead('news', 'news'); assert.equal(api.snapshot().unreadCount, 2);
  assert.equal(callsFor(h, 'operations/read').length, 2);
});

test('announcements are marked read only after successful detail rendering', async () => {
  const h = harness(), page = h.page('news/detail/news_detail');
  page.onLoad({ id: 'news' }); h.options.deferRender = true; await page.onShow();
  assert.equal(callsFor(h, 'operations/read').length, 0);
  h.render(); await tick();
  assert.deepEqual(callsFor(h, 'operations/read')[0].params, { id: 'news', kind: 'news' });
  page.onHide();
});

test('missing, failed and hidden announcement details never clear unread state', async () => {
  for (const result of [null, () => { throw Error('offline'); }]) {
    const h = harness(), page = h.page('news/detail/news_detail');
    h.responses['news/view'] = result; page.onLoad({ id: 'news' }); await page.onShow(); await tick();
    assert.equal(callsFor(h, 'operations/read').length, 0);
  }
  const h = harness(), pending = deferred(), page = h.page('news/detail/news_detail');
  h.responses['news/view'] = () => pending.promise; page.onLoad({ id: 'news' }); const load = page.onShow(); page.onHide();
  pending.resolve({ _id: 'news' }); await load;
  assert.equal(callsFor(h, 'operations/read').length, 0); assert.equal(page.data.news, null);
});

for (const [route, endpoint] of [
  ['mail/my_detail/mail_my_detail', 'mail/view'], ['feedback/detail/feedback_detail', 'feedback/my_detail'], ['my/reputation/my_reputation', 'reputation/summary']
]) {
  test(route + ' acknowledges the clicked message after rendering, but not on a failed load', async () => {
    const h = harness(), page = h.page(route); h.options.deferRender = true;
    page.onLoad({ id: 'detail', notificationId: 'notice' }); await page.onShow();
    assert.equal(callsFor(h, 'operations/read').length, 0);
    h.render(); await tick(); assert.equal(callsFor(h, 'operations/read')[0].params.id, 'notice');
    const bad = harness(), failed = bad.page(route); bad.responses[endpoint] = null;
    failed.onLoad({ id: 'detail', notificationId: 'notice' }); await failed.onShow();
    assert.equal(callsFor(bad, 'operations/read').length, 0);
  });
}

test('message list alone and navigation failure do not clear unread; feedback links open the exact reply', async () => {
  const h = harness(), page = h.page('operations/operations');
  h.responses['operations/notifications'] = { list: [{ _id: 'notice', feedbackId: 'fb?1', orderId: 'order', read: false }], hasMore: false };
  page.onLoad(); await page.onShow(); assert.equal(callsFor(h, 'operations/read').length, 0);
  h.options.navigationFails = true; await page.bindRead(event('notice'));
  assert.match(h.navigation.at(-1).url, /feedback_detail\?id=fb%3F1&notificationId=notice$/);
  assert.equal(callsFor(h, 'operations/read').length, 0); assert.equal(page.data.list[0].read, false); assert.equal(page._reading, false);
  page.onHide();
});

test('generic message displays its full content before acknowledgement and repeated taps open once', async () => {
  const h = harness(), page = h.page('operations/operations'); h.options.deferModal = true;
  page._visible = true; page.setData({ list: [{ _id: 'notice', read: false, title: '处理通知', content: '完整处理说明' }] });
  const first = page.bindRead(event('notice')); await page.bindRead(event('notice'));
  assert.equal(h.modals.length, 1); assert.equal(h.modals[0].content, '完整处理说明'); assert.equal(callsFor(h, 'operations/read').length, 0);
  h.modals[0].success({ confirm: true }); await first;
  assert.equal(page.data.list[0].read, true); assert.equal(callsFor(h, 'operations/read').length, 1);
});

test('unread filter rejects stale list responses and pagination carries the server cursor', async () => {
  const h = harness(), page = h.page('operations/operations'), old = deferred();
  h.responses['operations/notifications'] = params => params.unreadOnly
    ? { list: [{ _id: params.page === 1 ? 'unread' : 'next', read: false }], hasMore: params.page === 1,
      nextCursor: { createdAt: 1, id: 'unread', kind: 'notification' } } : old.promise;
  page.onLoad(); const initial = page.onShow(); await tick(); await page.bindUnreadFilter();
  old.resolve({ list: [{ _id: 'stale' }], hasMore: false }); await initial;
  assert.equal(page.data.list[0]._id, 'unread');
  await page.bindMore(); assert.equal(page.data.list[1]._id, 'next');
  assert.equal(callsFor(h, 'operations/notifications').at(-1).params.cursor.id, 'unread');
  page.onHide();
});

test('mark all waits for the server, coalesces taps and retains failed state', async () => {
  const h = harness(), page = h.page('operations/operations'), pending = deferred();
  page.onLoad(); await page.onShow(); await tick();
  h.responses['operations/read_all'] = () => pending.promise;
  const first = page.bindReadAll(); await page.bindReadAll();
  assert.equal(callsFor(h, 'operations/read_all').length, 1); assert.equal(page.data.unreadCount, 3);
  pending.reject(Error('offline')); await first;
  assert.equal(page.data.unreadCount, 3); assert.equal(page.data.markingAll, false);
  h.responses['operations/read_all'] = { ok: true }; h.responses['operations/summary'] = { ...h.summary, unreadCount: 0 };
  await page.bindReadAll(); assert.equal(page.data.unreadCount, 0); page.onHide();
});

test('home, personal center and custom tab bar receive the same badge and home opens the actual announcement', async () => {
  const h = harness(), home = h.page('default/index/default_index'), my = h.page('my/index/my_index'), tab = h.page('custom-tab-bar/index');
  tab.watchMessages(); home.onLoad(); home.onShow(); my.onLoad(); await my.onShow(); await tick();
  assert.equal(home.data.messageBadge, '3'); assert.equal(my.data.messageBadge, '3'); assert.equal(tab.data.unreadCount, 3);
  home.bindNoticeTap(); assert.match(h.navigation.at(-1).url, /news_detail\?id=news$/);
  home.bindAllNews(); assert.match(h.navigation.at(-1).url, /news_index$/);
  h.responses['operations/summary'] = { ...h.summary, unreadCount: 0 };
  await h.notifications().markRead('news', 'news');
  assert.equal(home.data.messageBadge, ''); assert.equal(my.data.messageBadge, ''); assert.equal(tab.data.unreadCount, 0);
  home.onHide(); my.onHide(); tab.stopMessages(); assert.equal(h.timers.size, 0);
});
