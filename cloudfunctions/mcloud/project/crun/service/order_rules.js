'use strict';
const AppError = require('../../../framework/core/app_error.js');
const fail = message => { throw new AppError(message); };
const ACTIVE = [1, 2, 3];
const LABELS = {0:'待接单',1:'配送中',2:'待确认收货',3:'异常处理中',9:'已完成',99:'已取消'};
function text(value, name, max, required = false) { if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) fail(name + '格式不正确'); return value.trim(); }
function images(value) { if (!Array.isArray(value) || value.length > 6 || value.some(x => typeof x !== 'string' || !x.startsWith('cloud://') || x.length > 500)) fail('图片必须先成功上传，最多6张'); return [...new Set(value)]; }
function validateForms(forms, config, now) {
 if (!Array.isArray(forms) || forms.length > 30) fail('表单数据无效');
 const input = Object.create(null);
 for (const item of forms) { if (!item || typeof item.mark !== 'string' || Object.prototype.hasOwnProperty.call(input,item.mark)) fail('表单字段重复或无效'); input[item.mark] = item.val; }
 const obj = {};
 for (const [key,name,max,required] of [['title','任务名称',50,true],['code','取件码',500,false],['address1','快递点',100,true],['address2','收件地址',200,true],['poster','联系人',30,true],['tel','手机号',11,true],['desc','备注',500,false],['campus','校区',30,true],['rider','骑手备注',30,false]]) obj[key] = text(input[key] == null ? '' : input[key],name,max,required);
 if (!/^1[3-9][0-9]{9}$/.test(obj.tel)) fail('手机号格式不正确');
 if (!config.campuses.includes(obj.campus)) fail('该校区不在服务范围');
 obj.imgUrls = images(input.img || []); obj.imgUrl = obj.imgUrls[0] || ''; if (!obj.code && !obj.imgUrls.length) fail('请填写取件码或上传取件截图');
 for (const name of ['small','medium','large']) { const raw = input[name] == null ? 0 : input[name]; if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+$/.test(raw))) fail('快递件数必须为整数'); const n = Number(raw); if (!Number.isInteger(n) || n < 0 || n > config.maxPackages) fail('快递件数超出限制'); obj[name] = n; }
 obj.num = obj.small + obj.medium + obj.large; if (obj.num < 1 || obj.num > config.maxPackages) fail('快递总件数超出限制');
 if (input.urgent != null && typeof input.urgent !== 'boolean') fail('加急参数无效'); obj.urgent = !!input.urgent; if (obj.urgent && !config.urgentEnabled) fail('当前未开放加急服务');
 const totalFee = obj.small * Math.round(config.smallPrice * 100) + obj.medium * Math.round(config.mediumPrice * 100) + obj.large * Math.round(config.largePrice * 100); obj.price = totalFee / 100;
 let endTime = now + 3 * 86400000;
 if (input.formEnd) { const value = text(input.formEnd,'截止时间',20,true); if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) fail('截止时间格式无效'); endTime = Date.parse(value.replace(' ','T') + '+08:00'); const expected = value.length === 16 ? value + ':00' : value; if (!Number.isFinite(endTime) || new Date(endTime + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') !== expected) fail('截止时间不是有效日期'); }
 if (!Number.isFinite(endTime) || endTime <= now || endTime > now + 7 * 86400000) fail('接单截止时间须在未来7天内');
 const normalized = Object.keys(obj).filter(k => !['imgUrl','imgUrls'].includes(k)).map(mark => ({ mark, title:mark, type:typeof obj[mark] === 'number' ? 'digit' : typeof obj[mark] === 'boolean' ? 'switch' : 'text', val:obj[mark] })); normalized.push({mark:'img',title:'相关图片',type:'image',val:obj.imgUrls}); if (input.formEnd) normalized.push({mark:'formEnd',title:'接单截止时间',type:'date',val:input.formEnd});
 return { obj, forms:normalized, totalFee, endTime };
}
function requireOpen(config, now) { if (!config.enabled) fail('服务暂停中，请联系校区客服'); const hour = new Date(now + 8 * 3600000).getUTCHours(); if (hour < config.openHour || hour >= config.closeHour) fail('当前不在营业时间'); }
function project(mail, userId, admin = false) {
 const privateAccess = admin || !!userId && [mail.MAIL_USER_ID,mail.MAIL_ACCEPT_USER_ID].includes(userId);
 const keys = ['_id','MAIL_ID','MAIL_STATUS','MAIL_END_TIME','MAIL_ADD_TIME','MAIL_ACCEPT_TIME','MAIL_OVER_TIME','MAIL_TOTAL_FEE','MAIL_PAYMENT_MODE','MAIL_CATE_ID','MAIL_CATE_NAME','MAIL_DUE_TIME','MAIL_DELIVERED_TIME'];
 if (privateAccess) keys.push('MAIL_FORMS','MAIL_HISTORY','MAIL_EXCEPTION','MAIL_DELIVERY_PROOF','MAIL_PAY_STATUS');
 const out = {}; keys.forEach(k => { if (mail[k] !== undefined) out[k] = mail[k]; });
 const publicFields = ['title','small','medium','large','num','price','urgent','campus','address1']; const obj = mail.MAIL_OBJ || {};
 out.MAIL_OBJ = privateAccess ? { ...obj } : Object.fromEntries(publicFields.filter(k => obj[k] !== undefined).map(k => [k,obj[k]]));
 out.mypost = mail.MAIL_USER_ID === userId; out.myaccept = mail.MAIL_ACCEPT_USER_ID === userId;
 out.status = LABELS[mail.MAIL_STATUS] || '状态未知'; if (mail.MAIL_STATUS === 0 && mail.MAIL_END_TIME < Date.now()) out.status = '已过期';
 out.overdue = ACTIVE.includes(mail.MAIL_STATUS) && mail.MAIL_DUE_TIME > 0 && mail.MAIL_DUE_TIME < Date.now();
 return out;
}
module.exports = { ACTIVE, LABELS, text, images, validateForms, requireOpen, project, fail };
