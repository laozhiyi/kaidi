const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
const cloud = require('../../../../../../helper/cloud_helper.js');
const Group = require('../../../../public/feedback_group.js');
const KEY = 'SETUP_CONTENT_AFTERSALES';
Page({
 data:{isLoad:false,loading:false,error:'',busy:false,groupNumber:Group.DEFAULT_NUMBER,note:'',configured:false},
 onLoad() { if(UI.start(this))return this.load(); },
 onShow() { if(this.data.isAdmin)UI.authorize(this); },
 onHide() { UI.hide(this); },
 onUnload() { this._unloaded=true; UI.hide(this); },
 async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
 bindBack() { UI.back('settings'); },
 async load() {
  if(!UI.authorize(this) || this.data.busy || this.data.loading)return;
  const editVersion=this._editVersion || 0;
  this.setData({loading:true,error:''});
  try {
   const content=await Ops.get('home/setup_get',{key:KEY});
   if(this._unloaded || !UI.authorize(this))return;
   const group=Group.read(content);
   if(editVersion===(this._editVersion || 0))this.setData({isLoad:true,groupNumber:group.number,note:group.note,configured:group.configured});
  } catch(error) { if(!this._unloaded)this.setData({error:UI.message(error)}); }
  finally { if(!this._unloaded)this.setData({loading:false}); }
 },
 bindInput(e) {
  if(this.data.busy || !UI.authorize(this))return;
  const field=e.currentTarget.dataset.field;
  if(!['groupNumber','note'].includes(field))return;
  this._editVersion=(this._editVersion || 0)+1;
  this.setData({[field]:e.detail.value,error:''});
 },
 async bindSave() {
  if(!UI.authorize(this) || this.data.busy || this.data.loading)return;
  let content;
  try { content=Group.build(this.data.groupNumber,this.data.note); }
  catch(error) { this.setData({error:error.message}); return; }
  this.setData({busy:true,error:''});
  try {
   await cloud.transRichEditorTempPics(content,'setup/',KEY,'admin/setup_set_content');
   if(this._unloaded || !UI.authorize(this))return;
   this.setData({configured:true,groupNumber:this.data.groupNumber.trim(),note:this.data.note.trim()});
   wx.showToast({title:'反馈群已更新',icon:'none'});
  } catch(error) { if(!this._unloaded)this.setData({error:UI.message(error)}); }
  finally { if(!this._unloaded)this.setData({busy:false}); }
 },
 bindViewPage() { wx.navigateTo({url:'/projects/crun/pages/feedback/index/feedback_index'}); }
});
