'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {runMiniProgram} = require('../test-support/miniprogram-module.cjs');
const root = path.resolve(__dirname, '../..');
const biz = name => path.join(root, 'miniprogram/projects/crun/biz', name + '.js');

test('field guidance waits for rendering, uses component scope and accounts for current scroll', () => {
 const calls=[], ticks=[];
 const page={data:{},setData(update,done){Object.assign(this.data,update);if(done)done();}};
 const wx={nextTick:callback=>ticks.push(callback),pageScrollTo:options=>calls.push(options),createSelectorQuery:()=>({
  in(target){assert.equal(target,page);return this;},select(selector){assert.equal(selector,'#guide-parcel-parcel-3');return this;},
  boundingClientRect(){return this;},selectViewport(){return this;},scrollOffset(){return this;},exec(callback){callback([{top:450},{scrollTop:300}]);}
 })};
 const guide=runMiniProgram(biz('form_guide_biz'),{wx});
 guide.show(page,'parcel-parcel-3','请填写第3件包裹的取件码');
 assert.equal(calls.length,0);ticks.shift()();
 assert.equal(calls[0].scrollTop,654);assert.equal(page.data.guideMessage,'请填写第3件包裹的取件码');
 guide.clear(page,'tel');assert.equal(page.data.guideField,'parcel-parcel-3');
 guide.clear(page,'parcel-parcel-3');assert.equal(page.data.guideField,'');
});

test('obsolete or unloaded guidance never scrolls a different field or a departed page', () => {
 const ticks=[],calls=[];
 const guide=runMiniProgram(biz('form_guide_biz'),{wx:{nextTick:callback=>ticks.push(callback),pageScrollTo:()=>calls.push(1),createSelectorQuery(){throw Error('stale query');}}});
 const page={data:{},setData(update,done){Object.assign(this.data,update);if(done)done();}};
 guide.show(page,'phone','手机号有误');guide.clear(page);ticks.shift()();
 guide.show(page,'agreement','请确认协议');page._unloaded=true;ticks.shift()();assert.equal(calls.length,0);
});

function operations() {
 const modals=[],navigation=[],origin={},state={user:'student',scope:'school:campus',generation:null,top:origin};
 const wx={showModal:options=>modals.push(options),navigateTo:options=>navigation.push(options.url)};
 const api=runMiniProgram(biz('operations_biz'),{wx,getCurrentPages:()=>[state.top],require:name=>{
  if(name.includes('cloud_helper'))return {scopeKey:()=>state.scope,onSessionChange:callback=>{state.generation=callback;}};
  if(name.includes('passport_biz'))return {getUserId:()=>state.user};
  if(name.includes('admin_biz'))return {getAdminToken:()=>null};
  if(name.includes('md5_lib'))return {md5:value=>value};
  throw Error('Unexpected dependency '+name);
 }});
 return {api,state,modals,navigation};
}
const agreementError=()=>new Error('请到个人资料阅读并确认新版用户服务协议与隐私政策后再接单');
test('agreement guidance offers an explicit choice and pushes the profile without submitting the original action', () => {
 const h=operations();h.api.error(agreementError());
 assert.equal(h.modals[0].confirmText,'去确认协议');assert.equal(h.modals[0].cancelText,'暂不处理');
 h.modals[0].success({confirm:false});assert.equal(h.navigation.length,0);
 h.modals[0].success({confirm:true});assert.match(h.navigation[0],/my_personal\?retUrl=back&focus=agreement$/);
 h.api.error(new Error('请到跑腿结算页阅读并确认新版骑手协议'));
 h.modals[1].success({confirm:true});assert.match(h.navigation[1],/settlement\?focus=agreement$/);
});
test('a changed session, campus or originating page invalidates a pending navigation choice', () => {
 for(const change of [h=>h.state.user='other',h=>h.state.scope='other',h=>h.state.generation(),h=>h.state.top={}]){
  const h=operations();h.api.error(agreementError());change(h);h.modals[0].success({confirm:true});assert.equal(h.navigation.length,0);
 }
});
test('network errors remain ordinary errors and uncertain submissions keep recovery priority', () => {
 const h=operations();h.api.error(new Error('网络异常'));assert.equal(h.modals[0].showCancel,false);assert.equal(h.modals[0].confirmText,'确定');
 const error=agreementError();error.recover=async()=>({state:'committed'});h.api.error(error);
 assert.equal(h.modals[1].confirmText,'核对上次');assert.equal(h.navigation.length,0);
});

const currentRecord={userVersion:'2026-11-27',privacyVersion:'2026-11-27',acceptedAt:1};
function acceptFlow(entry, options={}) {
 const modals=[],navigation=[],calls=[],loading=[],storage=new Map(),owner={};
 const state={token:{id:'student',sessionToken:'session',agreements:options.tokenRecord},scope:'school:campus',top:owner};
 const passport={getToken:()=>state.token,getUserId:()=>state.token.id,logoutEpoch:()=>0,setToken:token=>{state.token=token;},loginMustCancelWin:async()=>true};
 const wx={showModal:modal=>modals.push(modal),navigateTo:params=>navigation.push(params.url),redirectTo:params=>navigation.push(params.url),
  getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,value),removeStorageSync:key=>storage.delete(key),showLoading:options=>loading.push(options.title),hideLoading:()=>loading.push('hidden')};
 const globals={wx,getCurrentPages:()=>[state.top]};
 const cloud={scopeKey:()=>state.scope,async callCloudSumbit(route){
  calls.push(route);
  if(route==='passport/my_detail')return {data:{USER_NAME:'测试同学',USER_AGREEMENTS:options.savedRecord}};
  if(route==='settlement/status')return {data:{opened:true,consentCurrent:options.riderCurrent!==false}};
  if(route==='mail/accept'){
   if(options.acceptError)throw options.acceptError;
   if(options.acceptReply)return {data:await options.acceptReply};
   if(options.cloudDenies)throw {code:1600,msg:'请到个人资料阅读并确认新版用户服务协议与隐私政策后再接单'};
   return {data:{id:'order'}};
  }
  throw Error('Unexpected route '+route);
 }};
 const ops=runMiniProgram(biz('operations_biz'),{...globals,require:name=>{
  if(name.includes('cloud_helper'))return cloud;if(name.includes('passport_biz'))return passport;
  if(name.includes('admin_biz'))return {getAdminToken:()=>null};if(name.includes('md5_lib'))return {md5:value=>value};
  throw Error(name);
 }});
 const gate=runMiniProgram(biz('settlement_gate_biz'),{...globals,require:name=>name.includes('operations_biz')?ops:name.includes('passport_biz')?passport:name.includes('agreements')?require('../../miniprogram/projects/crun/public/agreements.js'): {}});
 const nativeHelper=options.realConfirm ? runMiniProgram(path.join(root,'miniprogram/helper/page_helper.js'),{...globals,require:()=>({})}) : null;
 let definition;
 runMiniProgram(path.join(root,'miniprogram/projects/crun/pages',entry),{...globals,Page:page=>{definition=page;},require:name=>{
  if(name.includes('operations_biz'))return ops;if(name.includes('settlement_gate_biz'))return gate;
  if(name.includes('passport_biz'))return passport;if(name.includes('mail_ui_biz'))return require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
  if(name.includes('page_helper'))return {showConfirm:nativeHelper ? nativeHelper.showConfirm : async()=>true,showSuccToast(){},showNoneToast(){},fmtURLByPID:url=>url};
  if(name.includes('public_biz'))return {removeCacheList(){}};
  return {};
 }});
 const order={_id:'order',MAIL_PAYMENT_MODE:options.mode||'adapay',canAccept:true};
 const page={...definition,_visible:true,data:{...structuredClone(definition.data),isLoad:true,mail:order,dataList:{list:[order]}},
  setData(update){for(const [key,value]of Object.entries(update)){const parts=key.split('.');let target=this.data;for(const part of parts.slice(0,-1))target=target[part]||={};target[parts.at(-1)]=value;}},selectComponent:()=>null,_loadDetail:async()=>{}};
 return {page,calls,modals,navigation,loading,state,accept:()=>page.bindAcceptTap({currentTarget:{dataset:{id:'order'}}})};
}
for(const entry of ['order/index/order_index.js','mail/detail/mail_detail.js']) {
 test(entry+': real native confirmation shows progress and sends only one accept command',async()=>{
  let release;const acceptReply=new Promise(resolve=>{release=resolve;});
  const h=acceptFlow(entry,{tokenRecord:currentRecord,realConfirm:true,acceptReply});
  const pending=h.accept();await new Promise(resolve=>setImmediate(resolve));
  assert(!h.calls.includes('mail/accept'));assert.match(h.modals[0].content,/尽快取件/);
  h.modals[0].success({confirm:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.calls.filter(route=>route==='mail/accept').length,1);assert(h.loading[0].includes('接单中'));
  await h.accept();assert.equal(h.calls.filter(route=>route==='mail/accept').length,1);
  release({id:'order'});await pending;
  assert.match(h.navigation[0],/my_detail\/mail_my_detail\?id=order$/);assert.equal(h.loading.at(-1),'hidden');
  assert.equal(h.page._accepting,false);
 });
 test(entry+': cancelling native confirmation sends no accept request',async()=>{
  const h=acceptFlow(entry,{tokenRecord:currentRecord,realConfirm:true});const pending=h.accept();
  await new Promise(resolve=>setImmediate(resolve));h.modals[0].success({confirm:false,cancel:true});await pending;
  assert(!h.calls.includes('mail/accept'));assert.equal(h.navigation.length,0);assert.equal(h.loading.length,0);
 });
 test(entry+': a timed-out accept stops progress and asks to reconcile rather than silently resubmit',async()=>{
  const h=acceptFlow(entry,{tokenRecord:currentRecord,realConfirm:true,acceptError:{msg:'网络响应超时，请检查操作结果后重试',retryable:false}});
  const pending=h.accept();await new Promise(resolve=>setImmediate(resolve));h.modals[0].success({confirm:true});await pending;
  assert.equal(h.calls.filter(route=>route==='mail/accept').length,1);
  assert.equal(h.loading.at(-1),'hidden');assert.equal(h.modals[1].confirmText,'核对上次');
  assert.match(h.modals[1].content,/超时/);assert.equal(h.page._accepting,false);assert.equal(h.navigation.length,0);
 });
 test(entry+': missing user terms are detected before settlement, confirmation or acceptance and can navigate',async()=>{
  const h=acceptFlow(entry);await h.accept();
  assert.deepEqual(h.calls,['passport/my_detail']);assert.equal(h.modals.length,1);assert.equal(h.modals[0].confirmText,'去确认协议');
  h.modals[0].success({confirm:true});assert.match(h.navigation[0],/my_personal\?retUrl=back&focus=agreement$/);
  assert(!h.calls.includes('mail/accept'));
 });
 test(entry+': rider terms use the same navigation prompt and focus the settlement checkbox',async()=>{
  const h=acceptFlow(entry,{tokenRecord:currentRecord,riderCurrent:false});await h.accept();
  assert.deepEqual(h.calls,['settlement/status']);assert.equal(h.modals[0].confirmText,'去确认协议');
  h.modals[0].success({confirm:true});assert.match(h.navigation[0],/settlement\?focus=agreement$/);
  assert(!h.calls.includes('mail/accept'));
 });
 test(entry+': an old token rechecks saved agreement without asking already accepted users again',async()=>{
  const h=acceptFlow(entry,{savedRecord:currentRecord});await h.accept();
  assert.deepEqual(h.calls,['passport/my_detail','settlement/status','mail/accept']);assert.equal(h.modals.length,0);
  assert.equal(h.state.token.agreements.userVersion,currentRecord.userVersion);
 });
 test(entry+': actual plain cloud errors still navigate after the command wrapper clears its pending record',async()=>{
  const h=acceptFlow(entry,{tokenRecord:currentRecord,cloudDenies:true});await h.accept();
  assert(h.calls.includes('mail/accept'));assert.equal(h.modals[0].confirmText,'去确认协议');
  h.modals[0].success({confirm:true});assert.match(h.navigation[0],/focus=agreement$/);
 });
}
