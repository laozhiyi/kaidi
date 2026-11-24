'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function settlement() {
 let definition;
 const modals = [];
 vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/my/settlement/settlement.js'), 'utf8'), {
  Page: page => { definition = page; },
  require: () => ({ initPage() {} }),
  wx: { showModal: options => modals.push(options) }
 });
 const page = { ...definition, data: structuredClone(definition.data), setData(update) {
  for (const [key, value] of Object.entries(update)) {
   if (key.startsWith('form.')) this.data.form[key.slice(5)] = value;
   else this.data[key] = value;
  }
 } };
 return { page, modals };
}
test('settlement requires explicit consent and cannot report opening success while the provider is unavailable', () => {
 const { page, modals } = settlement();
 assert.equal(page.data.rulesAccepted, false);
 assert.equal(page.data.authorizationAccepted, false);
 page.bindSubmit();
 assert.match(page.data.error, /姓名/);
 assert.equal(modals.length, 0);
 page.data.form = { realName:'测试同学', identity:'11010519491231002X', bankCard:'6222020000000000', phone:'13800000000' };
 page.bindSubmit();
 assert.match(page.data.error, /勾选/);
 page.bindAgreement({ detail:{ value:['rules'] } });
 page.bindSubmit();
 assert.equal(modals.length, 0);
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 page.bindSubmit();
 assert.equal(modals.length, 1);
 assert.equal(modals[0].title, '暂时无法开通');
 assert.match(modals[0].content, /申请未提交/);
 page.bindSubmit();
 assert.equal(modals.length, 1);
 modals[0].complete();
 assert.equal(page.data.submitting, false);
});
test('leaving settlement clears sensitive fields and both consent choices', () => {
 for (const lifecycle of ['onHide','onUnload']) {
  const { page } = settlement();
  page.data.form = { realName:'测试同学', identity:'11010519491231002X', bankCard:'6222020000000000', phone:'13800000000' };
  page.bindAgreement({ detail:{ value:['rules','authorization'] } });
  page[lifecycle]();
  assert(Object.values(page.data.form).every(value => value === ''));
  assert.equal(page.data.rulesAccepted, false);
  assert.equal(page.data.authorizationAccepted, false);
 }
});
test('my settlement entry navigates only after confirmation and ignores repeated taps', async () => {
 let page, resolveModal;
 const navigations = [];
 let modalCount = 0;
 const file = path.join(root, 'miniprogram/projects/crun/pages/my/index/my_index.js');
 vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
  Page: value => { page = value; },
  require: name => name.includes('passport_biz') ? { loginMustCancelWin: async () => true } : {},
  wx: {
   showModal(options) { modalCount++; resolveModal = options.success; assert.equal(options.content, '是否确定申请成为跑腿？'); },
   navigateTo(options) { navigations.push(options.url); }
  }
 });
 page._visible = true;
 const cancelled = page.bindSettlementTap();
 await new Promise(resolve => setImmediate(resolve));
 await page.bindSettlementTap();
 assert.equal(modalCount, 1);
 resolveModal({ confirm:false });
 await cancelled;
 assert.equal(navigations.length, 0);
 const confirmed = page.bindSettlementTap();
 await new Promise(resolve => setImmediate(resolve));
 resolveModal({ confirm:true });
 await confirmed;
 assert.deepEqual(navigations, ['/projects/crun/pages/my/settlement/settlement']);
});


test('unknown document keys cannot open a sheet', () => {
 const { page } = settlement();
 page.bindDocument({ currentTarget:{ dataset:{ kind:'constructor' } } });
 assert.equal(page.data.document, null);
 page.bindDocument({ currentTarget:{ dataset:{ kind:'privacy' } } });
 assert.equal(page.data.document.title, '实名信息处理说明');
});
