const cloudHelper = require('../../../../helper/cloud_helper.js');
const Group = require('../../public/feedback_group.js');
const KEY = 'SETUP_CONTENT_AFTERSALES';
Component({
 data: {group:Group.read([]),loading:false,error:false},
 lifetimes: {
  attached() { this._detached=false; this.load(); },
  detached() { this._detached=true; }
 },
 methods: {
  async load() {
   if(this.data.loading)return;
   this.setData({loading:true,error:false});
   try {
    const result=await cloudHelper.callCloudSumbit('home/setup_get',{key:KEY},{hint:false});
    if(!result || result.data===undefined)throw new Error('反馈群信息加载失败');
    if(!this._detached)this.setData({group:Group.read(result.data)});
   } catch(error) { if(!this._detached)this.setData({error:true}); }
   finally { if(!this._detached)this.setData({loading:false}); }
  },
  bindCopy() {
   const number=this.data.group && this.data.group.number;
   if(!number)return;
   wx.setClipboardData({data:number,
    success:()=>wx.showToast({title:'群号已复制，请打开 QQ 搜索',icon:'none'}),
    fail:()=>wx.showToast({title:'复制失败，可长按群号复制',icon:'none'})});
  }
 }
});
