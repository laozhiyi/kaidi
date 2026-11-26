'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function settlement(reply = async () => {throw new Error('结算服务暂不可用');}) {
 let definition;
 const modals = [];
 vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/my/settlement/settlement.js'), 'utf8'), {
  Page: page => { definition = page; },
  require: name => name.includes('operations_biz') ? {get:reply} : {initPage() {}},
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
test('settlement requires explicit consent and cannot report opening success while the provider is unavailable', async () => {
 const { page, modals } = settlement();
 assert.equal(page.data.rulesAccepted, false);
 assert.equal(page.data.authorizationAccepted, false);
 page.setData({statusLoading:false,account:{opened:false}});
 await page.bindSubmit();
 assert.match(page.data.error, /姓名/);
 assert.equal(modals.length, 0);
 page.data.form = { realName:'测试同学', identity:'11010519491231002X', bankCard:'6222020000000000', phone:'13800000000' };
 await page.bindSubmit();
 assert.match(page.data.error, /勾选/);
 page.bindAgreement({ detail:{ value:['rules'] } });
 await page.bindSubmit();
 assert.equal(modals.length, 0);
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 await page.bindSubmit();
 assert.equal(modals.length, 0);
 assert.match(page.data.error, /服务暂不可用/);
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
function settlementEntry(reply = async () => ({opened:false})) {
 let page;
 const navigations=[],modals=[],toasts=[],calls=[];
 const context={sessionToken:'session-A',scope:'campus-A'};
 vm.runInNewContext(fs.readFileSync(path.join(root,'miniprogram/projects/crun/pages/my/index/my_index.js'),'utf8'),{
  Page:value=>{page=value;},
  require:name=>{
   if(name.includes('passport_biz'))return {loginMustCancelWin:async()=>true,getToken:()=>({sessionToken:context.sessionToken})};
   if(name.includes('operations_biz'))return {get:async route=>{calls.push(route);return reply();}};
   if(name.includes('cloud_helper'))return {scopeKey:()=>context.scope};
   if(name.includes('page_helper'))return {showNoneToast:message=>toasts.push(message)};
   return {};
  },
  wx:{showModal:options=>modals.push(options),navigateTo:options=>navigations.push(options.url)}
 });
 page._visible=true;page._visit=1;
 return {page,navigations,modals,toasts,calls,context};
}

test('unopened settlement entry asks for confirmation and ignores repeated taps',async()=>{
 const h=settlementEntry();
 const cancelled=h.page.bindSettlementTap();await new Promise(resolve=>setImmediate(resolve));
 await h.page.bindSettlementTap();assert.equal(h.modals.length,1);assert.equal(h.calls.length,1);
 assert.equal(h.modals[0].content,'是否确定申请成为跑腿？');
 h.modals[0].success({confirm:false});await cancelled;assert.equal(h.navigations.length,0);
 const confirmed=h.page.bindSettlementTap();await new Promise(resolve=>setImmediate(resolve));
 h.modals[1].success({confirm:true});await confirmed;
 assert.deepEqual(h.navigations,['/projects/crun/pages/my/settlement/settlement']);
});

test('opened settlement account enters directly without an application confirmation',async()=>{
 const h=settlementEntry(async()=>({opened:true}));await h.page.bindSettlementTap();
 assert.deepEqual(h.calls,['settlement/status']);assert.equal(h.modals.length,0);
 assert.deepEqual(h.navigations,['/projects/crun/pages/my/settlement/settlement']);
});

test('settlement entry refreshes opening status after a previous unopened visit',async()=>{
 let opened=false;const h=settlementEntry(async()=>({opened}));
 const pending=h.page.bindSettlementTap();await new Promise(resolve=>setImmediate(resolve));
 h.modals[0].success({confirm:false});await pending;
 opened=true;await h.page.bindSettlementTap();
 assert.equal(h.modals.length,1);assert.equal(h.calls.length,2);assert.equal(h.navigations.length,1);
});

test('status query blocks duplicate taps and does not navigate after page, account or campus changes',async()=>{
 for(const change of ['none','hide','visit','session','scope']){
  let resolveStatus;const h=settlementEntry(()=>new Promise(resolve=>{resolveStatus=resolve;}));
  const pending=h.page.bindSettlementTap();await new Promise(resolve=>setImmediate(resolve));
  await h.page.bindSettlementTap();assert.equal(h.calls.length,1);
  if(change==='hide')h.page._visible=false;
  if(change==='visit')h.page._visit++;
  if(change==='session')h.context.sessionToken='session-B';
  if(change==='scope')h.context.scope='campus-B';
  resolveStatus({opened:true});await pending;
  assert.equal(h.modals.length,0);assert.equal(h.navigations.length,change==='none'?1:0);
  assert.equal(h.page._openingSettlement,false);
 }
});

test('failed or malformed settlement status never prompts a new application and can be retried',async()=>{
 for(const result of [null,{},new Error('network failed')]){
  let ready=false;const h=settlementEntry(async()=>{if(ready)return {opened:true};if(result instanceof Error)throw result;return result;});
  await h.page.bindSettlementTap();assert.equal(h.modals.length,0);assert.equal(h.navigations.length,0);
  assert.deepEqual(h.toasts,['结算状态查询失败，请稍后重试']);assert.equal(h.page._openingSettlement,false);
  ready=true;await h.page.bindSettlementTap();assert.equal(h.navigations.length,1);
 }
});

test('unknown document keys cannot open a sheet', () => {
 const { page } = settlement();
 page.bindDocument({ currentTarget:{ dataset:{ kind:'constructor' } } });
 assert.equal(page.data.document, null);
 page.bindDocument({ currentTarget:{ dataset:{ kind:'privacy' } } });
 assert.equal(page.data.document.title, '实名信息处理说明');
});


test('settlement first render and slow loading never default to an unopened account',async()=>{
 let resolveStatus;const {page}=settlement(()=>new Promise(resolve=>{resolveStatus=resolve;}));
 assert.equal(page.data.statusLoading,true);assert.equal(page.data.account,null);
 const loading=page.onShow();
 assert.equal(page.data.statusLoading,true);assert.equal(page.data.account,null);
 resolveStatus({opened:true,name:'测**',cardTail:'1234'});await loading;
 assert.equal(page.data.statusLoading,false);assert.equal(page.data.account.opened,true);assert.equal(page.data.statusError,'');
});

test('settlement status failure hides the form and retry can recover either account state',async()=>{
 for(const opened of [false,true]){
  let attempt=0;const {page}=settlement(async()=>{if(++attempt===1)throw Error('network failed');return {opened};});
  await page.onShow();assert.equal(page.data.statusLoading,false);assert.equal(page.data.account,null);assert(page.data.statusError);
  await page.bindSubmit();assert.equal(attempt,1,'a hidden form cannot submit while status is unknown');
  await page.bindRetryStatus();assert.equal(page.data.statusError,'');assert.equal(page.data.account.opened,opened);
 }
});

test('malformed settlement status stays in a recoverable error state',async()=>{
 for(const reply of [null,{}, {opened:'true'}]){
  const {page}=settlement(async()=>reply);await page.onShow();
  assert.equal(page.data.account,null);assert.equal(page.data.statusLoading,false);assert(page.data.statusError);
 }
});

test('settlement retry ignores duplicate taps and late replies from previous page visits',async()=>{
 const replies=[];let calls=0;
 const {page}=settlement(()=>{calls++;return new Promise(resolve=>replies.push(resolve));});
 const first=page.onShow();await page.bindRetryStatus();assert.equal(calls,1);
 page.onHide();assert.equal(page.data.account,null);assert.equal(page.data.statusLoading,true);
 const second=page.onShow();assert.equal(calls,2);
 replies[0]({opened:false});await first;assert.equal(page.data.account,null);assert.equal(page.data.statusLoading,true);
 replies[1]({opened:true});await second;assert.equal(page.data.account.opened,true);
 page.onHide();assert.equal(page.data.account,null);assert.equal(page.data.statusLoading,true);
});
