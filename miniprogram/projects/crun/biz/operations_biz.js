const cloud = require('../../../helper/cloud_helper.js');
const Passport = require('../../../comm/biz/passport_biz.js');
const Admin = require('../../../comm/biz/admin_biz.js');
const md5 = require('../../../lib/tools/md5_lib.js').md5;
const uploadCache = new Map();
const requestId = () => 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
async function get(route, params = {}) { const result = await cloud.callCloudSumbit(route, params, {hint:false}); if (!result || result.data === undefined) throw new Error('未收到有效响应，请重试'); return result.data; }
async function command(route, params = {}) {
 const admin = route.startsWith('admin/') && Admin.getAdminToken();
 const identity = admin ? 'admin:'+admin.name+':'+md5(admin.token) : Passport.getUserId(); if(!identity)throw new Error('请先登录');
 const key = 'crun-pending:' + identity + ':' + route + ':' + (params.id || 'new');
 const signature = md5(JSON.stringify(params)); let pending = wx.getStorageSync(key);
 if (!pending || pending.signature !== signature) { pending = {signature,requestId:requestId()}; wx.setStorageSync(key,pending); }
 const result = await get(route,{...params,requestId:pending.requestId}); const current=wx.getStorageSync(key);if(current && current.requestId===pending.requestId)wx.removeStorageSync(key); return result;
}
async function upload(paths) {
 if(!Array.isArray(paths)||paths.length>6)throw new Error('最多上传6张图片');
 if (!paths.length) return [];
 const config=await get('operations/config'),result=[];
 for(const original of paths){
  if(original.startsWith('cloud://')){result.push(original);continue;}
  if(uploadCache.has(config.uploadPrefix+original)){result.push(uploadCache.get(config.uploadPrefix+original));continue;}
  let filePath=original;
  const info=await new Promise((resolve,reject)=>wx.getFileInfo({filePath,success:resolve,fail:reject}));
  if(info.size>1024*1024){const compressed=await new Promise((resolve,reject)=>wx.compressImage({src:filePath,quality:60,success:resolve,fail:reject}));filePath=compressed.tempFilePath;}
  const finalInfo=await new Promise((resolve,reject)=>wx.getFileInfo({filePath,success:resolve,fail:reject}));if(finalInfo.size>1024*1024)throw new Error('图片压缩后仍超过1MB，请选择较小图片');
  const file=await wx.cloud.uploadFile({cloudPath:config.uploadPrefix+requestId()+'.jpg',filePath});if(uploadCache.size>100)uploadCache.clear();uploadCache.set(config.uploadPrefix+original,file.fileID);result.push(file.fileID);
 }
 return result;
}
async function subscribe(config) {
 if(!config.templateId || !wx.requestSubscribeMessage)return;
 try {const result=await new Promise((resolve,reject)=>wx.requestSubscribeMessage({tmplIds:[config.templateId],success:resolve,fail:reject}));if(result[config.templateId]==='accept')await get('operations/subscribe',{enabled:true});}catch(_){/* Declining a notification must not block the order. */}
}
function error(e){wx.showModal({title:'操作未完成',content:e && (e.msg || e.message) || '网络异常，请重试',showCancel:false});}
module.exports={get,command,upload,subscribe,requestId,error};
