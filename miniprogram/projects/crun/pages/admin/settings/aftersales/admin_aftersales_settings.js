const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
const cloud = require('../../../../../../helper/cloud_helper.js');
const Group = require('../../../../public/feedback_group.js');
const FeedbackImage = require('../../../../biz/feedback_image_biz.js');
const KEY = 'SETUP_CONTENT_AFTERSALES';
Page({
 data:{isLoad:false,loading:false,error:'',busy:false,choosing:false,qrImage:Group.DEFAULT_QR,note:'',configured:false},
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
   if(editVersion===(this._editVersion || 0))this.setData({isLoad:true,qrImage:group.image,note:group.note,configured:group.configured});
  } catch(error) { if(!this._unloaded)this.setData({error:UI.message(error)}); }
  finally { if(!this._unloaded)this.setData({loading:false}); }
 },
 bindInput(e) {
  if(this.data.busy || !UI.authorize(this))return;
  const field=e.currentTarget.dataset.field;
  if(field!=='note')return;
  this._editVersion=(this._editVersion || 0)+1;
  this.setData({[field]:e.detail.value,error:''});
 },
 bindChoose() {
  if(!UI.authorize(this) || this.data.busy || this.data.loading || this.data.choosing)return;
  this.setData({choosing:true});
  wx.chooseMedia({count:1,mediaType:['image'],sizeType:['original'],sourceType:['album','camera'],
   success:result=>{
    if(this._unloaded || !UI.authorize(this))return;
    const file=result.tempFiles && result.tempFiles[0];
    if(!file || !file.tempFilePath)return;
    if(file.size > 1024*1024) {this.setData({error:'二维码图片请控制在1MB以内'});return;}
    this._editVersion=(this._editVersion || 0)+1;
    this.setData({qrImage:file.tempFilePath,error:''});
   },
   fail:error=>{if(!this._unloaded && !/cancel/i.test(error.errMsg || ''))this.setData({error:'图片选择失败，请稍后重试'});},
   complete:()=>{if(!this._unloaded)this.setData({choosing:false});}
  });
 },
 async bindPreview() {
  if(!UI.authorize(this) || this._previewing)return;
  this._previewing=true;
  try {
   const source=this.data.qrImage.startsWith('cloud://') ? await cloud.getTempFileURLOne(this.data.qrImage) : this.data.qrImage;
   const image=await FeedbackImage.localPath(source);
   if(!this._unloaded && UI.authorize(this))await new Promise((resolve,reject)=>wx.previewImage({current:image,urls:[image],success:resolve,fail:reject}));
  }catch(error){if(!this._unloaded)this.setData({error:UI.message(error)});}
  finally{this._previewing=false;}
 },
 async bindSave() {
  if(!UI.authorize(this) || this.data.busy || this.data.loading || this.data.choosing)return;
  let content;
  try { content=Group.build(this.data.qrImage,this.data.note); }
  catch(error) { this.setData({error:error.message}); return; }
  this.setData({busy:true,error:''});
  try {
   if(!/^(cloud:\/\/|https:\/\/)/.test(this.data.qrImage) || this.data.qrImage.startsWith('https://tmp/')) {
    let image=this.data.qrImage;
    if(image===Group.DEFAULT_QR) {
     image=await FeedbackImage.localPath(image);
    }
    const uploaded=await cloud.transTempPicOne(image,'setup/',KEY,false);
    if(!uploaded || !uploaded.startsWith('cloud://'))throw new Error('二维码上传未完成，请重试');
    if(this._unloaded || !UI.authorize(this))return;
    // Retain the uploaded file on a failed content save so retries do not upload twice.
    this.setData({qrImage:uploaded});
    content=Group.build(uploaded,this.data.note);
   }
   await cloud.transRichEditorTempPics(content,'setup/',KEY,'admin/setup_set_content');
   if(this._unloaded || !UI.authorize(this))return;
   this.setData({configured:true,note:this.data.note.trim()});
   wx.showToast({title:'反馈群已更新',icon:'none'});
  } catch(error) { if(!this._unloaded)this.setData({error:UI.message(error)}); }
  finally { if(!this._unloaded)this.setData({busy:false}); }
 },
 bindViewPage() { wx.navigateTo({url:'/projects/crun/pages/feedback/index/feedback_index'}); }
});
