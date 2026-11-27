'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {harness}=require('../test-support/admin-console-harness.cjs');
const {runMiniProgram}=require('../test-support/miniprogram-module.cjs');
const Group=require('../../miniprogram/projects/crun/public/feedback_group.js');
const root=path.resolve(__dirname,'../..');
const page='settings/aftersales/admin_aftersales_settings.js';
const KEY='SETUP_CONTENT_AFTERSALES';
const plain=value=>JSON.parse(JSON.stringify(value));

test('legacy WeChat images and text never replace the provided QQ group number',()=>{
 for(const nodes of [[],null,[{type:'img',val:'cloud://expired-wechat.png'}],[{type:'text',val:'微信群号 123456'},{type:'img',val:'old'}]]){
  assert.equal(Group.read(nodes).number,'856190901');assert.equal(Group.read(nodes).configured,false);
 }
 assert.deepEqual(Group.read(Group.build('123456789','申请请备注校区')),{number:'123456789',note:'申请请备注校区',configured:true});
 for(const input of ['', 'abc', '123', 'QQ群号856190901'])assert.throws(()=>Group.build(input),/群号/);
});

test('QQ group configuration remains protected from non-admin sessions',async()=>{
 const h=harness(page,()=>[],{denied:true});
 await h.page.onLoad();h.page.bindInput({currentTarget:{dataset:{field:'groupNumber'}},detail:{value:'123456789'}});
 await h.page.bindSave();assert.equal(h.calls.length,0);
});

test('admin reads configured QQ contacts or the provided default, without QR controls',async()=>{
 const h=harness(page,()=>Group.build('123456789','备注校区'));await h.page.onLoad();
 assert.equal(h.page.data.groupNumber,'123456789');assert.equal(h.page.data.note,'备注校区');
 const legacy=harness(page,()=>[{type:'img',val:'cloud://old.png'}]);await legacy.page.onLoad();
 assert.equal(legacy.page.data.groupNumber,'856190901');assert.equal(legacy.page.data.configured,false);
});

test('admin saves only QQ group text and preserves drafts on failure',async()=>{
 const h=harness(page,()=>[{type:'img',val:'cloud://old.png'}]);await h.page.onLoad();
 h.page.bindInput({currentTarget:{dataset:{field:'groupNumber'}},detail:{value:'856190901'}});
 h.page.bindInput({currentTarget:{dataset:{field:'note'}},detail:{value:'申请请备注校区'}});
 await h.page.bindSave();
 const save=h.calls.find(call=>call.route==='admin/setup_set_content');
 assert.equal(save.params.id,KEY);assert.deepEqual(plain(save.params.content),Group.build('856190901','申请请备注校区'));
 assert.equal(h.events.filter(item=>item.upload).length,0);assert.equal(h.page.data.busy,false);
 const failed=harness(page,route=>{if(route==='admin/setup_set_content')throw Error('网络异常');return [];});
 await failed.page.onLoad();failed.page.data.note='保留这段说明';await failed.page.bindSave();
 assert.equal(failed.page.data.note,'保留这段说明');assert.match(failed.page.data.error,/网络异常/);assert.equal(failed.page.data.busy,false);
});

test('invalid group numbers never save, and repeated taps submit once',async()=>{
 let release;const h=harness(page,route=>route==='admin/setup_set_content'?new Promise(resolve=>{release=resolve;}):[]);
 await h.page.onLoad();h.page.data.groupNumber='not-a-number';await h.page.bindSave();
 assert.equal(h.calls.filter(call=>call.route==='admin/setup_set_content').length,0);
 h.page.data.groupNumber='856190901';const pending=h.page.bindSave();await Promise.resolve();await h.page.bindSave();
 assert.equal(h.calls.filter(call=>call.route==='admin/setup_set_content').length,1);release({});await pending;
});

function card(reply){
 let definition;const copies=[],toasts=[];
 runMiniProgram(path.join(root,'miniprogram/projects/crun/cmpts/aftersales_card/aftersales_card.js'),{
  Component:component=>{definition=component;},require:name=>name.includes('feedback_group')?Group:{callCloudSumbit:async()=>({data:await reply()})},
  wx:{setClipboardData:options=>{copies.push(options.data);options.success();},showToast:options=>toasts.push(options.title)}
 });
 const component={...definition.methods,data:structuredClone(definition.data),setData(update){Object.assign(this.data,update);}};
 return {component,copies,toasts};
}
test('feedback card copies only the QQ number and keeps a usable default when offline',async()=>{
 const h=card(()=>[{type:'img',val:'cloud://expired.png'}]);await h.component.load();h.component.bindCopy();
 assert.deepEqual(h.copies,['856190901']);assert.match(h.toasts[0],/打开 QQ/);
 const offline=card(()=>{throw Error('offline');});await offline.component.load();offline.component.bindCopy();
 assert.equal(offline.component.data.error,true);assert.deepEqual(offline.copies,['856190901']);
});
test('a detached card ignores late configuration replies',async()=>{
 let release;const h=card(()=>new Promise(resolve=>{release=resolve;}));const pending=h.component.load();
 h.component._detached=true;release(Group.build('123456789'));await pending;
 assert.equal(h.component.data.group.number,'856190901');
});
test('group UI contains no QR rendering or image actions, and existing admin navigation remains reachable',()=>{
 const xml=fs.readFileSync(path.join(root,'miniprogram/projects/crun/cmpts/aftersales_card/aftersales_card.wxml'),'utf8');
 assert.match(xml,/云速取-反馈群/);assert.match(xml,/复制群号/);assert.doesNotMatch(xml,/<image|bindSave|bindPreview|二维码/);
 const settings=fs.readFileSync(path.join(root,'miniprogram/projects/crun/pages/admin/settings/index/admin_settings.js'),'utf8');
 assert.match(settings,/key: 'aftersales'/);assert.match(settings,/云速取-反馈群/);
});

test('a failed QQ group load shows the error, leaves loading and can be retried',async()=>{
 let fail=true;const h=harness(page,()=>{if(fail)throw Error('读取失败');return Group.build('123456789','');});
 await h.page.onLoad();
 assert.match(h.page.data.error,/读取失败/);assert.equal(h.page.data.loading,false);assert.equal(h.page.data.isLoad,false);
 assert.equal(h.page.data.groupNumber,Group.DEFAULT_NUMBER,'the default number stays visible');
 fail=false;await h.page.load();
 assert.equal(h.page.data.error,'');assert.equal(h.page.data.isLoad,true);assert.equal(h.page.data.groupNumber,'123456789');
});

test('the QQ group settings page is reachable from admin settings and the about list',()=>{
 const target='/projects/crun/pages/admin/settings/aftersales/admin_aftersales_settings';
 const {UI}=harness(page,()=>[]);
 assert.equal(UI.ROUTES.aftersales,target);assert.equal(UI.url('aftersales'),target);
 const app=fs.readFileSync(path.join(root,'miniprogram/app.json'),'utf8');assert.ok(app.includes('admin/settings/aftersales/admin_aftersales_settings'));
 const list=fs.readFileSync(path.join(root,'miniprogram/projects/crun/pages/admin/setup/about_list/admin_setup_about_list.wxml'),'utf8');
 const link=/wx:if="\{\{item\.key==='SETUP_CONTENT_AFTERSALES'\}\}"[^>]*bindtap="url" data-url="([^"]+)">设置 QQ 群号/.exec(list);
 assert.ok(link,'about list keeps the QQ group entry');
 const from=path.join(root,'miniprogram/projects/crun/pages/admin/setup/about_list');
 assert.equal(path.resolve(from,link[1]),path.join(root,'miniprogram'+target),'the relative link resolves to the settings page');
});
