'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {harness}=require('../test-support/admin-console-harness.cjs');
const {runMiniProgram}=require('../test-support/miniprogram-module.cjs');
const Group=require('../../miniprogram/projects/crun/public/feedback_group.js');
const FeedbackImage=require('../../miniprogram/projects/crun/biz/feedback_image_biz.js');
const root=path.resolve(__dirname,'../..');
const page='settings/aftersales/admin_aftersales_settings.js';
const KEY='SETUP_CONTENT_AFTERSALES';
const image='cloud://crun/setup/current-qr.png';
const plain=value=>JSON.parse(JSON.stringify(value));

test('old QQ settings and unmarked expired QR images use the supplied WeChat QR',()=>{
 for(const content of [null,[],[{type:'text',val:'QQ 群号：856190901'}],[{type:'img',val:'cloud://expired.png'}]]) {
  assert.equal(Group.read(content).image,Group.DEFAULT_QR);assert.equal(Group.read(content).configured,false);
 }
 assert.deepEqual(Group.read(Group.build(image,'备注校区')),{image,note:'备注校区',configured:true});
 assert.ok(fs.existsSync(path.join(root,'miniprogram',Group.DEFAULT_QR)));
 for(const invalid of ['', '856190901','javascript:alert(1)'])assert.throws(()=>Group.build(invalid));
 assert.throws(()=>Group.build(image,'字'.repeat(201)),/200/);
});
test('WeChat QR configuration keeps the existing admin permission boundary',async()=>{
 const h=harness(page,()=>[],{denied:true});await h.page.onLoad();h.page.bindChoose();await h.page.bindSave();
 assert.equal(h.calls.length,0);assert.equal(h.page.data.qrImage,Group.DEFAULT_QR);
});
test('admins load and save the marked QR through the existing content endpoint',async()=>{
 const h=harness(page,()=>Group.build(image,'原说明'));await h.page.onLoad();
 assert.equal(h.page.data.qrImage,image);
 h.page.bindInput({currentTarget:{dataset:{field:'note'}},detail:{value:'新说明'}});await h.page.bindSave();
 const call=h.calls.find(x=>x.route==='admin/setup_set_content');
 assert.equal(call.params.id,KEY);assert.deepEqual(plain(call.params.content),Group.build(image,'新说明'));
});
test('failed saves keep an uploaded replacement for retry without uploading again',async()=>{
 let fail=true;const h=harness(page,route=>{if(route==='admin/setup_set_content'&&fail)throw Error('网络异常');return [];});
 await h.page.onLoad();h.page.data.qrImage='wxfile://tmp/new.png';
 await h.page.bindSave();assert.match(h.page.data.error,/网络异常/);assert.match(h.page.data.qrImage,/^cloud:/);
 assert.equal(h.page.data.busy,false);fail=false;await h.page.bindSave();
 assert.equal(h.events.filter(x=>x.upload).length,1);assert.equal(h.page.data.configured,true);
});
test('a cancelled image chooser preserves the configured QR',async()=>{
 const h=harness(page,()=>Group.build(image),{mediaCancelled:true});await h.page.onLoad();h.page.bindChoose();
 assert.equal(h.page.data.qrImage,image);assert.equal(h.page.data.choosing,false);
});
test('unsaved edits are not replaced by late configuration and repeated saves submit once',async()=>{
 let release;const h=harness(page,route=>route==='admin/setup_set_content'?new Promise(resolve=>release=resolve):Group.build(image));
 await h.page.onLoad();const pending=h.page.bindSave();await h.page.bindSave();
 assert.equal(h.calls.filter(x=>x.route==='admin/setup_set_content').length,1);release({});await pending;
});
function card(reply,saveError,options={}) {
 let definition;const previews=[],saves=[],toasts=[],modals=[],copies=[];
 const platform={env:{USER_DATA_PATH:'wxfile://usr'},
  previewImage:value=>{previews.push(value);if(value.success)value.success();},
  getImageInfo:value=>options.infoError ? value.fail({errMsg:'getImageInfo:fail'}) : value.success({path:value.src===Group.DEFAULT_QR ? Group.DEFAULT_QR.slice(1) : '/tmp/qr.png'}),
  getFileSystemManager:()=>({copyFile:value=>{copies.push(value);options.copyError ? value.fail({errMsg:'copyFile:fail'}) : value.success();}}),
  saveImageToPhotosAlbum:value=>{saves.push(value.filePath);saveError?value.fail(saveError):value.success();},
  showToast:value=>toasts.push(value.title),showModal:value=>modals.push(value)};
 runMiniProgram(path.join(root,'miniprogram/projects/crun/cmpts/aftersales_card/aftersales_card.js'),{
  Component:value=>definition=value,
  require:name=>name.includes('feedback_group')?Group:name.includes('feedback_image_biz')?{localPath:source=>FeedbackImage.localPath(source,platform)}:{callCloudSumbit:async()=>({data:await reply()}),getTempFileURLOne:async()=> 'https://example.invalid/qr.png'},
  wx:platform
 });
 const component={...definition.methods,data:structuredClone(definition.data),setData(update){Object.assign(this.data,update);}};
 return {component,previews,saves,toasts,modals,copies,platform};
}
test('QR card previews the supplied default and explicitly saves it when offline',async()=>{
 const h=card(()=>{throw Error('offline');});await h.component.load();await h.component.bindPreview();await h.component.bindSave();
 assert.equal(h.component.data.error,true);assert.equal(h.previews[0].current,'wxfile://usr/feedback-wechat-group.png');
 assert.equal(h.copies[0].srcPath,Group.DEFAULT_QR.slice(1));
 assert.deepEqual(h.saves,['wxfile://usr/feedback-wechat-group.png']);assert.equal(h.component.data.saving,false);
});
test('cloud QR configuration resolves a preview URL before display',async()=>{
 const h=card(()=>Group.build(image));await h.component.load();
 assert.equal(h.component.data.group.image,'https://example.invalid/qr.png');
 await h.component.bindPreview();assert.equal(h.previews[0].current,'/tmp/qr.png');assert.equal(h.copies.length,0);
});

test('failed package extraction or image lookup never opens a broken preview and can be retried',async()=>{
 for(const options of [{copyError:true},{infoError:true}]){
  const h=card(()=>[],null,options);await h.component.bindPreview();
  assert.equal(h.previews.length,0);assert.equal(h.toasts.length,1);assert.equal(h.component._previewing,false);
  options.copyError=false;options.infoError=false;await h.component.bindPreview();assert.equal(h.previews.length,1);
 }
});

test('late image preparation and repeated preview taps do not open duplicate or detached viewers',async()=>{
 const h=card(()=>[]);let release;
 h.platform.getImageInfo=value=>release=value.success;
 const pending=h.component.bindPreview();await h.component.bindPreview();
 h.component._detached=true;release({path:Group.DEFAULT_QR.slice(1)});await pending;
 assert.equal(h.previews.length,0);assert.equal(h.component._previewing,false);
});

test('admin built-in QR preview also uses a copied user file',async()=>{
 const h=harness(page,()=>[]);await h.page.onLoad();await h.page.bindPreview();
 assert.equal(h.page._previewing,false);assert.equal(h.page.data.error,'');
});
test('save permission errors explain recovery, while user cancellation stays quiet',async()=>{
 for(const [errMsg,count] of [['saveImageToPhotosAlbum:fail auth deny',1],['saveImageToPhotosAlbum:fail cancel',0]]){
  const h=card(()=>[],{errMsg});await h.component.bindSave();
  assert.equal(h.modals.length,count);assert.equal(h.component.data.saving,false);
 }
});
test('detached cards ignore late configuration and do not trigger image actions',async()=>{
 let release;const h=card(()=>new Promise(resolve=>release=resolve));const pending=h.component.load();
 h.component._detached=true;release(Group.build(image));await pending;
 h.component.bindPreview();await h.component.bindSave();
 assert.equal(h.component.data.group.image,Group.DEFAULT_QR);assert.equal(h.previews.length,0);assert.equal(h.saves.length,0);
});
test('visible feedback UI uses WeChat QR and neutral feedback labels',()=>{
 const xml=fs.readFileSync(path.join(root,'miniprogram/projects/crun/cmpts/aftersales_card/aftersales_card.wxml'),'utf8');
 assert.match(xml,/show-menu-by-longpress/);assert.match(xml,/保存二维码/);assert.doesNotMatch(xml,/QQ|复制群号/);
 for(const file of ['pages/my/index/my_index.wxml','pages/feedback/index/feedback_index.wxml']){
  const source=fs.readFileSync(path.join(root,'miniprogram/projects/crun',file),'utf8');assert.match(source,/意见反馈/);assert.doesNotMatch(source,/投诉/);
 }
 const {UI}=harness(page,()=>[]);assert.match(UI.url('aftersales'),/admin_aftersales_settings$/);
});
