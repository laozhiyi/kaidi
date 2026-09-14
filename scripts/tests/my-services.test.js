'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('../test-support/operations-fixture.cjs');

test('personal lists paginate deterministically and exclude other users and projects', async () => {
  const f = fixture();
  const specs = [
    ['notification', 'userId', 'createdAt', () => new (f.load('operations_service.js'))().notifications('poster', 1)],
    ['feedback', 'FB_USER_ID', 'FB_ADD_TIME', () => new (f.load('feedback_service.js'))().getMyFeedbackList('poster', { page: 1 })],
    ['order_review', 'REVIEW_FROM_USER_ID', 'REVIEW_ADD_TIME', () => new (f.load('review_service.js'))().myList('poster', 1)],
    ['order_review', 'REVIEW_TO_USER_ID', 'REVIEW_ADD_TIME', () => new (f.load('review_service.js'))().myList('poster', 1, 'received')]
  ];
  for (const [name, owner, time, load] of specs) {
    for (let i = 0; i < 25; i++) f.table(name).set('own-' + i, { _id: 'own-' + i, _pid: 'crun', [owner]: 'poster', [time]: 1000 + i });
    f.table(name).set('other-user', { _id: 'other-user', _pid: 'crun', [owner]: 'rider', [time]: 999999 });
    f.table(name).set('other-project', { _id: 'other-project', _pid: 'other', [owner]: 'poster', [time]: 999999 });
    const first = await load();
    assert.equal(first.total, 25, name);
    assert.equal(first.list.length, 20, name);
    assert.equal(first.list[0]._id, 'own-24', name);
    assert.equal(first.hasMore, true, name);
    const second = await new (f.load('operations_service.js'))().list(name, { [owner]: 'poster' }, 2, time);
    assert.equal(second.list.length, 5, name);
    assert.equal(second.hasMore, false, name);
    assert.equal(new Set([...first.list, ...second.list].map(row => row._id)).size, 25);
  }
  await assert.rejects(new (f.load('operations_service.js'))().list('notification', {}, 0), /分页/);
});

test('favorites persist server-derived metadata, support literal search and remove without toggling', async () => {
  const f = fixture();
  f.store.database().RegExp = ({ regexp, options }) => ['like', new RegExp(regexp, options)];
  f.table('news').set('notice', { _id: 'notice', _pid: 'crun', NEWS_STATUS: 1, NEWS_TITLE: '活动[报名].通知' });
  const service = new (f.load('fav_service.js'))();
  assert.equal((await service.updateFav('poster', 'notice', 'news')).isFav, 1);
  assert.equal((await service.isFav('poster', 'notice', 'news')).isFav, 1);
  const list = await service.getMyFavList('poster', { search: '[报名].' });
  assert.equal(list.total, 1);
  assert.equal(list.list[0].FAV_TITLE, '活动[报名].通知');
  assert.equal(list.list[0].FAV_PATH, '/projects/crun/pages/news/detail/news_detail?id=notice');
  assert.equal((await service.getMyFavList('rider')).total, 0);
  assert.equal((await service.delFav('rider', 'notice')).effect, 0);
  f.table('news').delete('notice');
  assert.equal((await service.delFav('poster', 'notice')).effect, 1);
  assert.equal((await service.delFav('poster', 'notice')).effect, 0);
  assert.equal((await service.isFav('poster', 'notice', 'news')).isFav, 0);
});

test('favorites reject unknown types, hidden content, and users without active accounts', async () => {
  const f = fixture(), service = new (f.load('fav_service.js'))();
  f.table('news').set('hidden', { _id: 'hidden', _pid: 'crun', NEWS_STATUS: 0 });
  f.table('news').set('foreign', { _id: 'foreign', _pid: 'other', NEWS_STATUS: 1 });
  await assert.rejects(service.updateFav('poster', 'hidden', 'news'), /下架/);
  await assert.rejects(service.updateFav('poster', 'foreign', 'news'), /不存在/);
  await assert.rejects(service.updateFav('poster', 'hidden', '../user'), /不支持/);
  await assert.rejects(service.updateFav('guest', 'hidden', 'news'), /注册/);
  assert.equal(f.table('fav').size, 0);
});

test('favorite delete route calls deletion with the object id', async () => {
  const calls = [], module = { exports: {} };
  class Base { validateData() { return { oid: 'saved-object' }; } }
  class Service { async delFav(...args) { calls.push(args); return { effect: 1 }; } }
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/controller/fav_controller.js'), 'utf8'), {
    module, require: name => name.includes('base_project_controller') ? Base : name.includes('fav_service') ? Service : {}
  });
  const controller = new module.exports(); controller._userId = 'poster';
  assert.equal((await controller.delFav()).effect, 1);
  assert.deepEqual(calls, [['poster', 'saved-object']]);
});

test('an invite code stays stable and never appears as a fake invitation record', async () => {
  const f = fixture(), service = new (f.load('invite_service.js'))();
  const [first, second] = await Promise.all([service.getOrCreateMyInviteCode('poster'), service.getOrCreateMyInviteCode('poster')]);
  assert.match(first.code, /^[A-Z0-9]{6}$/);
  assert.equal(first.code, second.code);
  assert.equal((await service.getMyInviteList('poster')).total, 0);
  assert.equal((await service.getMyInviteStat('poster')).total, 0);
  await service.acceptInvite('rider', first.code);
  await service.acceptInvite('rider2', first.code);
  assert.equal((await service.getOrCreateMyInviteCode('poster')).code, first.code);
  const list = await service.getMyInviteList('poster');
  assert.equal(list.total, 2);
  assert.equal(new Set(list.list.map(item => item.INV_ACCEPT_USER_ID)).size, 2);
  assert.equal((await service.getMyInviteStat('poster')).accepted, 2);
  assert.equal((await service.getMyInviteStat('poster')).reward, 0);
});

test('concurrent invite acceptance binds each person once and retries preserve the first inviter', async () => {
  const f = fixture(), service = new (f.load('invite_service.js'))();
  const a = await service.getOrCreateMyInviteCode('poster'), b = await service.getOrCreateMyInviteCode('other');
  const results = await Promise.all([service.acceptInvite('rider', a.code), service.acceptInvite('rider', b.code)]);
  assert.equal(results[0].inviter, results[1].inviter);
  const again = await service.acceptInvite('rider', b.code);
  assert.equal(again.alreadyAccepted, true);
  assert.equal(again.inviter, results[0].inviter);
  assert.equal([...f.table('invite').values()].filter(item => item.INV_ACCEPT_USER_ID === 'rider').length, 1);
});

test('invite binding validates registration, code ownership and project scope', async () => {
  const f = fixture(), service = new (f.load('invite_service.js'))();
  const code = (await service.getOrCreateMyInviteCode('poster')).code;
  assert.equal((await service.acceptInvite('poster', code)).accepted, false);
  assert.equal((await service.acceptInvite('rider', 'ZZZZZZ')).accepted, false);
  await assert.rejects(service.acceptInvite('guest', code), /注册/);
  f.table('invite').set('foreign-code', { _id: 'foreign-code', _pid: 'elsewhere', INV_CODE: 'ABCDEF', INV_USER_ID: 'poster' });
  assert.equal((await service.acceptInvite('rider', 'ABCDEF')).accepted, false);
  f.user('pending-user', { USER_STATUS: 0 });
  assert.equal((await service.acceptInvite('pending-user', code)).accepted, true);
});

test('legacy invite codes and accepted relationships survive the new flow', async () => {
  const f = fixture(), service = new (f.load('invite_service.js'))();
  f.table('invite').set('legacy', { _id: 'legacy', _pid: 'crun', INV_USER_ID: 'poster', INV_CODE: 'ABCDEF', INV_ACCEPT_USER_ID: 'rider', INV_STATUS: 1, INV_ADD_TIME: 1 });
  assert.equal((await service.getOrCreateMyInviteCode('poster')).code, 'ABCDEF');
  assert.equal((await service.acceptInvite('rider', 'ABCDEF')).alreadyAccepted, true);
  assert.equal((await service.acceptInvite('rider2', 'ABCDEF')).accepted, true);
  assert.equal((await service.getMyInviteStat('poster')).total, 2);
  assert.equal(f.table('invite').get('legacy').INV_ACCEPT_USER_ID, 'rider');
});
