'use strict';
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const AppError = require('../../../framework/core/app_error.js');
// Only call after checking order participation / administrator permission.
async function urls(ids) {
 const files = [...new Set((ids || []).filter(x => typeof x === 'string' && x.startsWith('cloud://')))];
 if (!files.length) return [];
 const result = await cloudBase.getCloud().getTempFileURL({fileList:files.map(fileID => ({fileID,maxAge:300}))});
 const map = new Map((result.fileList || []).map(x => [x.fileID,x.tempFileURL]));
 if (files.some(id => !map.get(id))) throw new AppError('图片暂时无法读取，请刷新重试');
 return ids.map(id => map.get(id)).filter(Boolean);
}
async function order(dto) {
 if (!dto || !dto.MAIL_FORMS) return dto;
 const obj = dto.MAIL_OBJ || {};
 const groups = {
  pickup: [...(obj.imgUrls || []), ...((obj.packages || []).flatMap(item => Array.isArray(item && item.images) ? item.images : []))],
  proof: dto.MAIL_DELIVERY_PROOF && dto.MAIL_DELIVERY_PROOF.images || [],
  exception: dto.MAIL_EXCEPTION && dto.MAIL_EXCEPTION.images || []
 };
 dto.MAIL_MEDIA = {};
 delete dto.MAIL_MEDIA_ERROR;
 await Promise.all(Object.entries(groups).map(async ([name, ids]) => {
  try { dto.MAIL_MEDIA[name] = await urls(ids); }
  catch (e) {
   // Only degrade previews AFTER authorization. Never expose raw file URLs as a fallback.
   dto.MAIL_MEDIA[name] = [];
   dto.MAIL_MEDIA_ERROR = '部分图片暂时无法读取，订单文字信息仍可查看，请稍后刷新重试';
   console.warn('[order media] preview unavailable', { group: name, code: e.code || e.errCode || 'PREVIEW_ERROR' });
  }
 }));
 return dto;
}
async function feedback(dto) { dto.FB_IMG_PREVIEW = await urls(dto.FB_IMG || []); return dto; }
module.exports = {urls,order,feedback};
