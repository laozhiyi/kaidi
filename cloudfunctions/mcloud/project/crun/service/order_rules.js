'use strict';
const AppError = require('../../../framework/core/app_error.js');
const fail = message => { throw new AppError(message); };
const ACTIVE = [1, 2, 3, 4];
const LABELS = { 0: '待接单', 1: '已接单', 2: '待收货', 3: '异常处理中', 4: '已取件', 9: '已完成', 99: '已取消' };
function text(value, name, max, required = false) { if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) fail(name + '格式不正确'); return value.trim(); }
function images(value) { if (!Array.isArray(value) || value.length > 6 || value.some(x => typeof x !== 'string' || !x.startsWith('cloud://') || x.length > 500)) fail('图片必须先成功上传，最多6张'); return [...new Set(value)]; }
function validateForms(forms, config, now) {
 if (!Array.isArray(forms) || forms.length > 30) fail('表单数据无效');
 const input = Object.create(null);
 for (const item of forms) { if (!item || typeof item.mark !== 'string' || Object.prototype.hasOwnProperty.call(input,item.mark)) fail('表单字段重复或无效'); input[item.mark] = item.val; }
 const obj = {};
 for (const [key,name,max,required] of [['title','任务名称',50,true],['code','取件码',500,false],['address1','快递点',100,true],['address2','收件地址',200,true],['poster','联系人',30,true],['tel','手机号',11,true],['desc','备注',500,false],['tel2','\u7b2c\u4e8c\u8054\u7cfb\u65b9\u5f0f',100,false],['campus','校区',30,true]]) obj[key] = text(input[key] == null ? '' : input[key],name,max,required);
 if (!/^1[3-9][0-9]{9}$/.test(obj.tel)) fail('手机号格式不正确');
 if (!config.campuses.includes(obj.campus)) fail('该校区不在服务范围');
 obj.imgUrls = images(input.img || []); obj.imgUrl = obj.imgUrls[0] || '';
 for (const name of ['small','medium','large']) { const raw = input[name] == null ? 0 : input[name]; if (typeof raw !== 'number' && !(typeof raw === 'string' && /^\d+$/.test(raw))) fail('快递件数必须为整数'); const n = Number(raw); if (!Number.isInteger(n) || n < 0 || n > config.maxPackages) fail('快递件数超出限制'); obj[name] = n; }
 obj.num = obj.small + obj.medium + obj.large; if (obj.num < 1 || obj.num > config.maxPackages) fail('package count invalid');
 let parcelItems = input.packages;
 if (typeof parcelItems === 'string' && parcelItems.trim()) { try { parcelItems = JSON.parse(parcelItems); } catch (_) { fail('package proof invalid'); } }
 if (parcelItems == null) parcelItems = [];
 if (!Array.isArray(parcelItems) || parcelItems.length > config.maxPackages) fail('package proof count invalid');
 if (parcelItems.length) {
  const counts = { small:0, medium:0, large:0 };
  parcelItems = parcelItems.map(item => { if (!item || !['small','medium','large'].includes(item.type)) fail('package type invalid'); counts[item.type]++; const price = Number(item.price); if (!Number.isFinite(price) || price < 0.01 || price > 10000) fail('package price invalid'); const code = text(item.code || '','code',200,false); const note = text(item.note || '','note',300,false); const packageImages = images(item.images || []); if (code && packageImages.length) fail('package proof must choose code or image'); return { type:item.type, price:Number(price.toFixed(2)), code, note, images:packageImages }; });
  if (counts.small !== obj.small || counts.medium !== obj.medium || counts.large !== obj.large) fail('package proof count mismatch');
  obj.packages = parcelItems;
 } else obj.packages = [];
 const packageCodes = obj.packages.map(item => item.code).filter(Boolean);
 const packageImages = obj.packages.reduce((all, item) => all.concat(item.images || []), []);
 if (obj.imgUrls.length + packageImages.length > 6) fail('\u56fe\u7247\u5fc5\u987b\u5148\u6210\u529f\u4e0a\u4f20\uff0c\u6700\u591a6\u5f20');
 if (!obj.code && packageCodes.length) obj.code = packageCodes.join('\n');
 if (!obj.imgUrls.length && packageImages.length) { obj.imgUrls = packageImages.slice(0, 6); obj.imgUrl = obj.imgUrls[0] || ''; }
 if (!obj.code && !obj.imgUrls.length) fail('\u8bf7\u586b\u5199\u53d6\u4ef6\u7801\u6216\u4e0a\u4f20\u53d6\u4ef6\u622a\u56fe');
 if (input.urgent != null && typeof input.urgent !== 'boolean') fail('加急参数无效'); obj.urgent = !!input.urgent; if (obj.urgent && !config.urgentEnabled) fail('当前未开放加急服务');
 const referenceFee = obj.small * Math.round(config.smallPrice * 100) + obj.medium * Math.round(config.mediumPrice * 100) + obj.large * Math.round(config.largePrice * 100);
 let totalFee = obj.packages.length ? Math.round(obj.packages.reduce((sum, item) => sum + item.price * 100, 0)) : referenceFee;
 if (input.price !== undefined && input.price !== null && input.price !== '') {
  const value = Number(input.price);
  if (!Number.isFinite(value) || value < 0.01 || value > 10000 || !/^\d+(?:\.\d{1,2})?$/.test(String(input.price).trim())) fail('费用须在0.01至10000元之间，最多保留两位小数');
  if (!obj.packages.length) totalFee = Math.round(value * 100);
 }
 obj.price = totalFee / 100; obj.referencePrice = referenceFee / 100;
 let endTime = now + 3 * 86400000;
 if (input.formEnd) { const value = text(input.formEnd,'截止时间',20,true); if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) fail('截止时间格式无效'); endTime = Date.parse(value.replace(' ','T') + '+08:00'); const expected = value.length === 16 ? value + ':00' : value; if (!Number.isFinite(endTime) || new Date(endTime + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') !== expected) fail('截止时间不是有效日期'); }
 if (!Number.isFinite(endTime) || endTime <= now || endTime > now + 7 * 86400000) fail('接单截止时间须在未来7天内');
 const normalized = Object.keys(obj).filter(k => !['imgUrl','imgUrls'].includes(k)).map(mark => ({ mark, title:mark, type:typeof obj[mark] === 'number' ? 'digit' : typeof obj[mark] === 'boolean' ? 'switch' : 'text', val:obj[mark] })); normalized.push({mark:'img',title:'相关图片',type:'image',val:obj.imgUrls}); if (input.formEnd) normalized.push({mark:'formEnd',title:'接单截止时间',type:'date',val:input.formEnd});
 return { obj, forms:normalized, totalFee, endTime };
}
function requireOpen(config) { if (!config.enabled) fail('服务暂停中，请联系校区客服'); }
function project(mail, userId, admin = false) {
 const privateAccess = admin || !!userId && [mail.MAIL_USER_ID,mail.MAIL_ACCEPT_USER_ID].includes(userId);
 const keys = ['_id','MAIL_ID','MAIL_STATUS','MAIL_END_TIME','MAIL_ADD_TIME','MAIL_ACCEPT_TIME','MAIL_PICKUP_TIME','MAIL_OVER_TIME','MAIL_TOTAL_FEE','MAIL_PAYMENT_MODE','MAIL_CATE_ID','MAIL_CATE_NAME','MAIL_DUE_TIME','MAIL_DELIVERED_TIME'];
 if (privateAccess) keys.push('MAIL_FORMS','MAIL_HISTORY','MAIL_EXCEPTION','MAIL_DELIVERY_PROOF','MAIL_PAY_STATUS');
 const out = {}; keys.forEach(k => { if (mail[k] !== undefined) out[k] = mail[k]; });
 const publicFields = ['title','small','medium','large','num','price','referencePrice','urgent','campus']; const obj = mail.MAIL_OBJ || {};
 out.MAIL_OBJ = privateAccess ? { ...obj } : Object.fromEntries(publicFields.filter(k => obj[k] !== undefined).map(k => [k,obj[k]]));
 out.mypost = mail.MAIL_USER_ID === userId; out.myaccept = mail.MAIL_ACCEPT_USER_ID === userId;
 out.status = LABELS[mail.MAIL_STATUS] || '状态未知'; if (mail.MAIL_STATUS === 0 && mail.MAIL_END_TIME < Date.now()) out.status = '已过期';
 out.overdue = ACTIVE.includes(mail.MAIL_STATUS) && mail.MAIL_DUE_TIME > 0 && mail.MAIL_DUE_TIME < Date.now();
 const progressMap = { 0: 0, 1: 0, 4: 2, 2: 3, 9: 4 };
 out.progressStep = progressMap[mail.MAIL_STATUS] === undefined ? 0 : progressMap[mail.MAIL_STATUS];
 out.progressLabels = ['已接单', '已取件', '配送中', '待收货', '已完成'];
 return out;
}
module.exports = { ACTIVE, LABELS, text, images, validateForms, requireOpen, project, fail };
