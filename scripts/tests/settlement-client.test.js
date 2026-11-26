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
  require: name => name.includes('form_guide_biz') ? require('../test-support/miniprogram-module.cjs').runMiniProgram(path.join(root,'miniprogram/projects/crun/biz/form_guide_biz.js'),{wx:{}}) : name.includes('operations_biz') ? {get:reply} : name.includes('agreements') ? require('../../miniprogram/projects/crun/public/agreements.js') : {initPage() {}},
  wx: { showModal: options => modals.push(options), navigateTo: options => modals.push({navigation:options.url}) }
 });
 const page = { ...definition, data: structuredClone(definition.data), setData(update) {
  for (const [key, value] of Object.entries(update)) {
   if (key.startsWith('form.')) this.data.form[key.slice(5)] = value;
   else this.data[key] = value;
  }
 } };
 return { page, modals };
}
test('an opened account accepts updated terms with versions only and does not resubmit bank details', async () => {
 const calls=[], {page}=settlement(async(route,input)=>{calls.push({route,input});return {opened:true,consentCurrent:true,cardTail:'1234'};});
 page._active=true;page._generation=1;
 page.setData({statusLoading:false,account:{opened:true,consentCurrent:false}});
 await page.bindSubmit();assert.equal(calls.length,0);
 page.bindAgreement({detail:{value:['rules','authorization']}});await page.bindSubmit();
 assert.equal(calls[0].route,'settlement/accept');
 assert.deepEqual(Object.keys(calls[0].input).sort(),['authorizationAccepted','authorizationVersion','rulesAccepted','rulesVersion']);
 assert.equal(calls[0].input.rulesVersion,'2026-11-27');
 assert.equal(page.data.account.consentCurrent,true);
});

test('settlement validation locates the first invalid field, then each independent consent without provider writes', async () => {
 const calls=[],{page}=settlement(async(route,input)=>{calls.push({route,input});return {};});
 page.data.account={opened:false};page.data.statusLoading=false;
 await page.bindSubmit();assert.equal(page.data.guideField,'realName');
 for(const [field,value,next] of [['realName','测试同学','identity'],['identity','110101199001011234','bankCard'],['bankCard','6212345678901234','phone'],['phone','13800000000','rules']]){
  page.bindInput({currentTarget:{dataset:{field}},detail:{value}});assert.equal(page.data.guideField,'');
  await page.bindSubmit();assert.equal(page.data.guideField,next);
 }
 page.bindAgreement({detail:{value:['rules']}});await page.bindSubmit();assert.equal(page.data.guideField,'authorization');
 assert.equal(calls.length,0);assert.equal(page.data.form.realName,'测试同学');
});
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
 // 云端失败原因用弹窗明确告知，且不会显示成开通成功。
 assert.equal(modals.length, 1);
 assert.equal(modals[0].title, '开通未成功');
 assert.match(modals[0].content, /服务暂不可用/);
 assert.equal(page.data.error, '');
 assert.equal(page.data.submitting, false);
 assert.equal(page.data.form.realName, '测试同学', 'a failed submission keeps the form for correction');
});
const filled = () => ({ realName:'测试同学', identity:'11010519491231002X', bankCard:'6222020000000000', phone:'13800000000' });
test('closing settlement clears sensitive fields and both consent choices', () => {
 const { page } = settlement();
 page.data.form = filled();
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 page.onUnload();
 assert(Object.values(page.data.form).every(value => value === ''));
 assert.equal(page.data.rulesAccepted, false);
 assert.equal(page.data.authorizationAccepted, false);
});
test('switching to the background keeps the form in page memory without reloading', async () => {
 let calls = 0;
 const { page } = settlement(async () => { calls++; return { opened:false }; });
 await page.onShow();
 page.data.form = filled();
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 page.onHide();
 assert.deepEqual(page.data.form, filled());
 const refresh = page.onShow();
 assert.equal(page.data.statusLoading, false, 'returning does not flash the loading state');
 await refresh;
 assert.equal(calls, 2);
 assert.deepEqual(page.data.form, filled());
 assert.equal(page.data.rulesAccepted, true);
 assert.equal(page.data.authorizationAccepted, true);
});
test('a long absence clears the form when the page is shown again', async () => {
 const { page } = settlement(async () => ({ opened:false }));
 await page.onShow();
 page.data.form = filled();
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 page.onHide();
 page._hiddenAt -= 11 * 60 * 1000;
 await page.onShow();
 assert(Object.values(page.data.form).every(value => value === ''));
 assert.equal(page.data.rulesAccepted, false);
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
 const { page, modals } = settlement();
 page.bindDocument({ currentTarget:{ dataset:{ kind:'constructor' } } });
 assert.equal(page.data.document, null);
 page.bindDocument({ currentTarget:{ dataset:{ kind:'privacy' } } });
 assert.equal(page.data.document, null);
 assert.match(modals.at(-1).navigation, /about_agreement\?key=identity$/);
 page.bindDocument({ currentTarget:{ dataset:{ kind:'rules' } } });
 assert.match(modals.at(-1).navigation, /about_agreement\?key=rider$/);
 const agreement = require('../../miniprogram/projects/crun/public/agreements.js').get('rider');
 assert(agreement.blocks.some(block => block.type === 'p' && block.segments.some(seg => seg.b)), 'bold clauses stay bold');
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
 page.onHide();const third=page.onShow();assert.equal(calls,3);assert.equal(page.data.statusLoading,false);
 page.onHide();replies[2]({opened:false});await third;assert.equal(page.data.account.opened,true,'a late silent refresh is ignored');
 page.onUnload();assert.equal(page.data.account,null);assert.equal(page.data.statusLoading,true);
});

test('an opened account can change its settlement card and reports the result', async () => {
 const routes = [];
 const { page, modals } = settlement(async (route, params) => {
  routes.push(route);
  if (route === 'settlement/status') return { opened:true, name:'测**', cardTail:'1234' };
  assert.equal(params.bankCard, '6222020000005678');
  return { opened:true, name:'测**', cardTail:'5678' };
 });
 await page.onShow();
 await page.bindSubmit();
 assert.deepEqual(routes, ['settlement/status'], 'an opened account cannot resubmit the opening form');
 page.bindStartChange();
 assert.equal(page.data.mode, 'change');
 page.data.form = { ...filled(), bankCard:'6222020000005678' };
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 await page.bindSubmit();
 assert.deepEqual(routes, ['settlement/status', 'settlement/change']);
 assert.equal(modals[0].title, '更换成功');
 assert.match(modals[0].content, /5678/);
 assert.equal(page.data.mode, 'open');
 assert(Object.values(page.data.form).every(value => value === ''));
});

test('a failed card change shows the reason, keeps the form and follows the refreshed state', async () => {
 let opened = true;
 const { page, modals } = settlement(async route => {
  if (route === 'settlement/status') return { opened, identified:true, name:'测**', cardTail:'1234' };
  opened = false;
  throw Object.assign(new Error('x'), { msg:'原结算银行卡已解除，新卡未绑定成功：银行预留手机号与银行登记的不一致' });
 });
 await page.onShow();
 page.bindStartChange();
 page.data.form = filled();
 page.bindAgreement({ detail:{ value:['rules','authorization'] } });
 await page.bindSubmit();
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(modals[0].title, '更换未完成');
 assert.match(modals[0].content, /预留手机号/);
 assert.equal(page.data.account.opened, false);
 assert.equal(page.data.mode, 'open', 'the unbound account continues with the opening form');
 assert.deepEqual(page.data.form, filled());
 page.bindCancelChange();
});
