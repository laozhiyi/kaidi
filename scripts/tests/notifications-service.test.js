'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
function setup() {
  const f = fixture(), service = new (f.load('notification_service.js'))();
  const news = (id, extra = {}) => f.table('news').set(id, { _id: id, _pid: 'crun', NEWS_STATUS: 1,
    NEWS_TITLE: '公告 ' + id, NEWS_DESC: '请查看服务安排', NEWS_ORDER: 9999, NEWS_ADD_TIME: 1000, NEWS_EDIT_TIME: 1000, ...extra });
  const message = (id, extra = {}) => f.table('notification').set(id, { _id: id, _pid: 'crun', userId: 'poster',
    title: '订单更新', content: '配送中', createdAt: 1000, read: false, ...extra });
  return { ...f, service, news, message };
}

test('unread summary counts beyond SDK page limits and excludes other users, projects and stopped announcements', async () => {
  const f = setup();
  for (let i = 0; i < 241; i++) f.news('news-' + String(i).padStart(3, '0'));
  for (let i = 0; i < 131; i++) {
    const id = 'news-' + String(i).padStart(3, '0');
    await f.service.markRead('poster', id, 'news');
  }
  f.news('stopped', { NEWS_STATUS: 0 }); f.news('foreign', { _pid: 'other' });
  for (let i = 0; i < 7; i++) f.message('message-' + i);
  f.message('other-user', { userId: 'other' }); f.message('other-project', { _pid: 'other' }); f.message('read', { read: true });
  const summary = await f.service.summary('poster');
  assert.equal(summary.newsUnread, 110); assert.equal(summary.personalUnread, 7); assert.equal(summary.unreadCount, 117);
  assert.equal((await f.service.summary('other')).newsUnread, 241);
  assert.equal(f.table('notification').size, 10, 'announcements are not copied into every user inbox');
});

test('reading an announcement is persistent, idempotent and independent per user, and edits retain read state', async () => {
  const f = setup(); f.news('one'); f.news('two', { NEWS_ORDER: 0 });
  assert.equal((await f.service.summary('poster')).featuredNews.newsId, 'two');
  await Promise.all([f.service.markRead('poster', 'two', 'news'), f.service.markRead('poster', 'two', 'news')]);
  assert.equal(f.table('news_read').size, 1);
  f.table('news').get('two').NEWS_TITLE = '修改标题';
  const otherInstance = new (f.load('notification_service.js'))();
  assert.equal((await otherInstance.summary('poster')).unreadCount, 1);
  assert.equal((await otherInstance.summary('poster')).featuredNews.newsId, 'one');
  assert.equal((await otherInstance.summary('rider')).unreadCount, 2);
  f.table('news').get('one').NEWS_STATUS = 0;
  assert.equal((await f.service.summary('poster')).unreadCount, 0);
  assert.equal((await f.service.list('poster')).list.length, 1);
  f.table('news').delete('two');
  assert.equal((await f.service.list('poster')).list.length, 0);
});

test('message reads and summaries enforce identity, project and active-user permissions', async () => {
  const f = setup(); f.news('one'); f.news('foreign', { _pid: 'other' }); f.news('stopped', { NEWS_STATUS: 0 });
  f.message('private', { userId: 'rider', delivery: 'pending' });
  await assert.rejects(f.service.markRead('poster', 'private'), /不存在/);
  await assert.rejects(f.service.markRead('poster', 'foreign', 'news'), /不存在/);
  await assert.rejects(f.service.markRead('poster', 'stopped', 'news'), /不存在/);
  await assert.rejects(f.service.markRead('poster', 'one', 'other'), /类型/);
  f.user('poster', { USER_STATUS: 9 });
  await assert.rejects(f.service.summary('poster'), /注册审核/);
  await assert.rejects(f.service.markAllRead('poster'), /注册审核/);
  await assert.rejects(f.service.markRead('poster', 'one', 'news'), /注册审核/);
  assert.equal(f.table('news_read').size, 0);
  await f.service.markRead('rider', 'private');
  assert.equal(f.table('notification').get('private').read, true);
  assert.equal(f.table('notification').get('private').delivery, 'pending');
});

test('cursor pagination merges announcements and private messages without gaps at equal timestamps', async () => {
  const f = setup(), expected = [];
  for (let i = 0; i < 73; i++) {
    const id = String(i).padStart(3, '0');
    f.news('n' + id); f.message('m' + id);
    expected.push('news:n' + id, 'notification:m' + id);
  }
  expected.sort().reverse();
  let cursor, page = 1; const actual = [];
  for (;;) {
    const result = await f.service.list('poster', { cursor, page, unreadOnly: true });
    assert.equal(result.total, 146); assert.ok(result.list.length <= 20);
    actual.push(...result.list.map(row => row.key));
    if (!result.hasMore) break;
    cursor = result.nextCursor; page++;
  }
  assert.deepEqual(actual, expected);
  const legacy = await f.service.list('poster', { page: 7 });
  assert.deepEqual(copy(legacy.list.map(row => row.key)), expected.slice(120, 140));
  assert.ok(!JSON.stringify(legacy).includes('userId'));
  await assert.rejects(f.service.list('poster', { cursor: { createdAt: 'bad', kind: 'news', id: 'one' } }), /分页/);
});

test('reading earlier rows and new arrivals do not shift subsequent unread pages', async () => {
  const f = setup();
  for (let i = 1; i <= 50; i++) f.message('m' + String(i).padStart(2, '0'), { createdAt: i });
  const first = await f.service.list('poster', { unreadOnly: true });
  await f.service.markRead('poster', first.list[0]._id);
  f.message('new', { createdAt: 100 });
  const second = await f.service.list('poster', { page: 2, unreadOnly: true, cursor: first.nextCursor });
  assert.deepEqual(copy(second.list.map(row => row._id)), Array.from({ length: 20 }, (_, i) => 'm' + (30 - i)));
});

test('mark all reads every page, preserves deliveries, and leaves messages arriving during the write unread', async () => {
  const f = setup();
  for (let i = 0; i < 125; i++) { f.news('n' + i); f.message('m' + i, { delivery: 'retry' }); }
  f.message('other', { userId: 'rider' });
  const db = f.store.database(), original = db.collection;
  let injected = false;
  db.collection = name => {
    const query = original(name), update = query.update;
    query.update = async args => {
      if (!injected) { injected = true; f.message('just-arrived', { createdAt: 2000 }); f.news('just-published', { NEWS_ADD_TIME: 2000 }); }
      return update(args);
    };
    return query;
  };
  await f.service.markAllRead('poster');
  assert.equal((await f.service.summary('poster')).unreadCount, 2);
  assert.equal(f.table('notification').get('other').read, false);
  assert.equal(f.table('notification').get('m1').delivery, 'retry');
  assert.equal(f.table('news_read').size, 125);
  await f.service.markAllRead('poster');
  assert.equal((await f.service.summary('poster')).unreadCount, 0);
  assert.equal((await f.service.list('poster', { unreadOnly: true })).list.length, 0);
});

test('public featured announcement is pinned first and never includes private message fields', async () => {
  const f = setup(); f.news('newer', { NEWS_ADD_TIME: 3000 }); f.news('pinned', { NEWS_ORDER: 0 });
  f.news('hidden', { NEWS_ORDER: -1, NEWS_STATUS: 0 }); f.message('private');
  const result = await f.service.featured();
  assert.equal(result.featuredNews.newsId, 'pinned'); assert.equal(result.featuredNews.read, null);
  assert.ok(!JSON.stringify(result).includes('private'));
});

test('announcement draft returns the document id and becomes visible only after content is uploaded and published', async () => {
  const f = setup(), admin = new (f.load('admin/admin_news_service.js'))();
  const result = await admin.insertNews({ title: '服务安排', draft: true, forms: [] });
  assert.ok(f.table('news').has(result.id));
  assert.notEqual(result.id, f.table('news').get(result.id).NEWS_ID);
  assert.equal((await f.service.summary('poster')).unreadCount, 0);
  await assert.rejects(admin.statusNews(result.id, 1), /正文/);
  await admin.updateNewsContent({ id: result.id, content: [{ type: 'text', val: '今天的服务安排' }] });
  await admin.statusNews(result.id, 1);
  assert.equal((await f.service.summary('poster')).unreadCount, 1);
});
