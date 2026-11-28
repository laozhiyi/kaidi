const cloudHelper = require('../../../../helper/cloud_helper.js');
const Group = require('../../public/feedback_group.js');
const FeedbackImage = require('../../biz/feedback_image_biz.js');
const KEY = 'SETUP_CONTENT_AFTERSALES';
Component({
 data: {group:Group.read([]),loading:false,error:false,imageError:false,saving:false},
 lifetimes: {
  attached() { this._detached=false; this.load(); },
  detached() { this._detached=true; }
 },
 methods: {
  async load() {
   if(this.data.loading)return;
   this.setData({loading:true,error:false,imageError:false});
   try {
    const result=await cloudHelper.callCloudSumbit('home/setup_get',{key:KEY},{hint:false});
    if(!result || result.data===undefined)throw new Error('反馈群信息加载失败');
    const group=Group.read(result.data);
    if(group.image.startsWith('cloud://')) group.image=await cloudHelper.getTempFileURLOne(group.image);
    if(!group.image)throw new Error('反馈群二维码暂不可用');
    if(!this._detached)this.setData({group});
   } catch(error) { if(!this._detached)this.setData({error:true}); }
   finally { if(!this._detached)this.setData({loading:false}); }
  },
  bindImageError() { this.setData({imageError:true}); },
  async bindPreview() {
   if(this._detached || this.data.imageError || this._previewing)return;
   this._previewing=true;
   try {
    const image=await FeedbackImage.localPath(this.data.group.image);
    if(this._detached)return;
    await new Promise((resolve,reject)=>wx.previewImage({current:image,urls:[image],success:resolve,fail:reject}));
   }catch(error){if(!this._detached)wx.showToast({title:'预览失败，请稍后重试，或尝试保存二维码',icon:'none'});}
   finally{this._previewing=false;}
  },
  async bindSave() {
   if(this._detached || this.data.saving || this.data.imageError)return;
   this.setData({saving:true});
   try {
    const path=await FeedbackImage.localPath(this.data.group.image);
    if(this._detached)return;
    await new Promise((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath:path,success:resolve,fail:reject}));
    if(!this._detached)wx.showToast({title:'已保存到相册',icon:'success'});
   } catch(error) {
    if(!this._detached && !/cancel/i.test(error && error.errMsg || ''))wx.showModal({title:'二维码未保存',content:/auth|authorize|deny|denied/i.test(error && error.errMsg || '') ? '请在微信或手机设置中允许保存到相册，也可点击二维码查看大图后尝试长按识别。' : '图片暂时无法保存，请稍后重试，或直接在小程序提交反馈。',showCancel:false});
   } finally {if(!this._detached)this.setData({saving:false});}
  }
 }
});
