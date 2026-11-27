'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client(entry) {
 let page, identity = '', subscriptions = 0, gates = 0, commands = 0;
 const prompts = [], navigations = [];
 const passport = { getUserId: () => identity, loginMustCancelWin: async (_, options) => { prompts.push(options); return !!identity; } };
 const wx = { getStorageSync: () => '', removeStorageSync() {}, navigateTo: value => navigations.push(value), showLoading() {}, hideLoading() {} };
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/pages/' + entry), 'utf8'), {
  Page: value => page = value, wx, console: { info() {} },
  require(name) {
   if (name.includes('passport_biz')) return passport;
   if (name.includes('order_sync_biz')) return { subscribe() { subscriptions++; return () => {}; } };
   if (name.includes('order_fav_biz')) return { watch: () => ({ stop() {}, refresh() {} }) };
   if (name.includes('settlement_gate_biz')) return { ensureSettlement: async () => { gates++; return true; } };
   if (name.includes('operations_biz')) return { get: async () => ({}), command: async () => { commands++; return { id: 'order' }; } };
   if (name.includes('project_biz')) return { initPage() {} };
   if (name.includes('page_helper')) return { showConfirm: async () => false };
   return {};
  }
 });
 page.data = structuredClone(page.data);
 page.setData = patch => Object.assign(page.data, patch);
 page._visible = true;
 page.data.id = 'order';
 page.data.isLoad = true;
 page.data.mail = { _id: 'order', canAccept: true };
 page._loadDetail = async () => {};
 page._syncOrders = async () => {};
 return { page, prompts, navigations, login: () => identity = 'student', counts: () => ({ subscriptions, gates, commands }) };
}

for (const [entry, field] of [['order/index/order_index.js', 'acceptingId'], ['mail/detail/mail_detail.js', 'accepting']]) {
 test(entry + ': guest browsing makes no authenticated feed subscription, while login restores it', () => {
  const h = client(entry);
  h.page.onShow();
  assert.equal(h.counts().subscriptions, 0);
  assert.equal(h.navigations.length, 0);
  h.login(); h.page.onShow();
  assert.equal(h.counts().subscriptions, 1);
 });
 test(entry + ': guest acceptance stops before qualification and mutation and releases the button', async () => {
  const h = client(entry);
  await h.page.bindAcceptTap({ currentTarget: { dataset: { id: 'order' } } });
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].action, 'accept');
  assert.equal(h.counts().gates, 0);
  assert.equal(h.counts().commands, 0);
  assert.equal(!!h.page.data[field], false);
  assert.equal(h.page._accepting, false);
  h.login();
  await h.page.bindAcceptTap({ currentTarget: { dataset: { id: 'order' } } });
  assert.equal(h.counts().gates, 1, 'the next explicit tap follows the normal qualification flow');
  assert.equal(h.counts().commands, 0, 'declining the final confirmation never accepts');
 });
}

test('guest personal-tab selection stays public and does not send a private-list request', () => {
 const h = client('order/index/order_index.js');
 h.page.bindTabTap({ currentTarget: { dataset: { idx: 1 } } });
 assert.equal(h.page.data.tabIndex, 0);
 assert.equal(h.prompts.length, 1);
 h.page.data.tabIndex = 2;
 h.page.onShow();
 assert.equal(h.page.data.tabIndex, 0, 'returning after logout clears personal selection');
});
