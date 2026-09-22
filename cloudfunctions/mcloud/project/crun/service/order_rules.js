'use strict';
const AppError = require('../../../framework/core/app_error.js');
const deliveryAddress = require('./delivery_address.js');
const fail = message => { throw new AppError(message); };
const ACTIVE = [1, 2, 3, 4];
const LABELS = { 0: '待接单', 1: '已接单', 2: '待收货', 3: '异常处理中', 4: '已取件', 9: '已完成', 99: '已取消' };
const plugins = require('./order_plugins/index.js');
const SERVICES = plugins.services;
function text(value, name, max, required = false) { if (typeof value !== 'string' || value.trim().length > max || required && !value.trim()) fail(name + '格式不正确'); return value.trim(); }
function images(value) { if (!Array.isArray(value) || value.length > 6 || value.some(x => typeof x !== 'string' || !x.startsWith('cloud://') || x.length > 500)) fail('图片必须先成功上传，最多6张'); return [...new Set(value)]; }
function validateForms(forms, config, now) {
 if (!Array.isArray(forms) || forms.length > 30) fail('表单数据无效');
 const input = Object.create(null);
 for (const item of forms) { if (!item || typeof item.mark !== 'string' || Object.prototype.hasOwnProperty.call(input,item.mark)) fail('表单字段重复或无效'); input[item.mark] = item.val; }
 const obj = {};
 obj.serviceType = input.serviceType == null ? 'take' : text(input.serviceType, '服务类型', 10, true);
 if (!Object.prototype.hasOwnProperty.call(SERVICES, obj.serviceType)) fail('服务类型无效');

 for (const [key,name,max,required] of [['title','任务名称',50,true],['code','取件码',500,false],['address2','收件地址',200,true],['poster','联系人',30,true],['tel','手机号',11,true],['desc','备注',500,false],['tel2','\u7b2c\u4e8c\u8054\u7cfb\u65b9\u5f0f',100,false],['campus','校区',30,true]]) obj[key] = text(input[key] == null ? '' : input[key],name,max,required);
 if (!/^1[3-9][0-9]{9}$/.test(obj.tel)) fail('手机号格式不正确');
 if (!config.campuses.includes(obj.campus)) fail('该校区不在服务范围');
 const phases = config.locations ? config.locations.phases : deliveryAddress.PHASES;
 const addressPhase = text(input.addressPhase == null ? '' : input.addressPhase, '配送区域', 30);
 if (addressPhase) {
  if (!phases.includes(addressPhase)) fail('所属区域无效');
  const prefix = deliveryAddress.phaseOf(obj.address2, obj.campus, phases);
  if (prefix && prefix !== addressPhase) fail('收件地址与所属区域不一致');
  obj.addressPhase = addressPhase;
 }
 obj.address2 = text(deliveryAddress.resolve({ MAIL_OBJ:obj, MAIL_FORMS:forms }, phases),'收件地址',200,true);
 const resolvedPhase = deliveryAddress.phaseOf(obj.address2, obj.campus, phases);
 if (resolvedPhase) obj.addressPhase = resolvedPhase;
 if (input.urgent != null && typeof input.urgent !== 'boolean') fail('加急参数无效'); obj.urgent = !!input.urgent; if (obj.urgent && !config.urgentEnabled) fail('当前未开放加急服务');
 const quote = plugins.get(obj.serviceType).normalize(input, obj, config, {text,images,fail});
 const totalFee = quote.totalFee;
 if (!Number.isSafeInteger(totalFee) || totalFee < 1 || totalFee > 1000000) fail('订单费用超出范围');
 let endTime = now + 3 * 86400000;
 if (input.formEnd) { const value = text(input.formEnd,'截止时间',20,true); if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) fail('截止时间格式无效'); endTime = Date.parse(value.replace(' ','T') + '+08:00'); const expected = value.length === 16 ? value + ':00' : value; if (!Number.isFinite(endTime) || new Date(endTime + 8 * 3600000).toISOString().slice(0,19).replace('T',' ') !== expected) fail('截止时间不是有效日期'); }
 if (!Number.isFinite(endTime) || endTime <= now || endTime > now + 7 * 86400000) fail('接单截止时间须在未来7天内');
 const normalized = Object.keys(obj).filter(k => !['imgUrl','imgUrls'].includes(k)).map(mark => ({ mark, title:mark, type:typeof obj[mark] === 'number' ? 'digit' : typeof obj[mark] === 'boolean' ? 'switch' : 'text', val:obj[mark] })); normalized.push({mark:'img',title:'相关图片',type:'image',val:obj.imgUrls}); if (input.formEnd) normalized.push({mark:'formEnd',title:'接单截止时间',type:'date',val:input.formEnd});
 return { obj, forms:normalized, totalFee, endTime, schemaVersion:2,
  ruleSnapshot:{serviceType:obj.serviceType,pluginVersion:plugins.get(obj.serviceType).version,configVersion:config.version || 0,
   currency:'CNY',paymentMode:'offline',referenceFee:quote.referenceFee,totalFee,
   smallPrice:config.smallPrice,mediumPrice:config.mediumPrice,largePrice:config.largePrice,
   deliveryMinutes:obj.urgent ? config.urgentMinutes : config.deliveryMinutes,quotedAt:now} };
}
function requireOpen(config, now = Date.now()) {
 if (!config.enabled) fail('服务暂停中，请联系校区客服');
 if (config.enforceBusinessHours !== true) return;
 const hour = new Date(now + 8 * 3600000).getUTCHours();
 if (!Number.isInteger(config.openHour) || !Number.isInteger(config.closeHour) || config.openHour < 0 || config.closeHour > 24
  || config.openHour >= config.closeHour || !Number.isFinite(hour) || hour < config.openHour || hour >= config.closeHour) fail('当前不在营业时间，请稍后再试');
}
function project(mail, userId, admin = false) {
 mail = deliveryAddress.complete(mail);
 const mypost = !!userId && mail.MAIL_USER_ID === userId;
 const myaccept = !!userId && mail.MAIL_ACCEPT_USER_ID === userId;
 const privateAccess = admin || mypost || myaccept;
 const keys = ['_id','MAIL_ID','MAIL_STATUS','MAIL_END_TIME','MAIL_ADD_TIME','MAIL_ACCEPT_TIME','MAIL_PICKUP_TIME','MAIL_OVER_TIME','MAIL_TOTAL_FEE','MAIL_PAYMENT_MODE','MAIL_CATE_ID','MAIL_CATE_NAME','MAIL_DUE_TIME','MAIL_DELIVERED_TIME','MAIL_VERSION','MAIL_SCHEMA_VERSION','schoolId','campusId'];
 if (privateAccess) keys.push('MAIL_RULE_SNAPSHOT','MAIL_FORMS','MAIL_EXCEPTION','MAIL_DELIVERY_PROOF','MAIL_PAY_STATUS','MAIL_CAN_REVIEW','MAIL_REVIEWED');
 if (admin || mypost) keys.push('MAIL_HISTORY');
 const out = {}; keys.forEach(k => { if (mail[k] !== undefined) out[k] = mail[k]; });
 // Preserve safe milestone times before private history is removed. Projection
 // must not backfill the stored object or expose event notes to other readers.
 const recordedTime = (value, legacyEvent = false) => {
  let at = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  // Some old event logs store ISO dates. Numeric sentinels such as '-1' must
  // never fall through to Date.parse, which interprets them as calendar dates.
  const iso = legacyEvent && typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (iso) {
   const wall = iso[1] + ':' + (iso[2] || '00'), calendar = new Date(wall + 'Z');
   if (Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 19) === wall) at = Date.parse(value);
  }
  return Number.isFinite(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? at : 0;
 };
 const history = (Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY : []).filter(item => item && typeof item === 'object');
 out.MAIL_MILESTONES = {};
 for (const [field, actions] of [
  ['MAIL_ADD_TIME', ['publish']], ['MAIL_ACCEPT_TIME', ['accept']],
  ['MAIL_PICKUP_TIME', ['pickup']], ['MAIL_DELIVERED_TIME', ['deliver']],
  ['MAIL_OVER_TIME', ['confirm', 'finish', 'complete', 'admin_finish', 'resolve_complete']]
 ]) {
  const events = history.filter(item => actions.includes(item.action) || field === 'MAIL_OVER_TIME' && item.action === 'resolve' && Number(item.status) === 9);
  const event = events.find(item => recordedTime(item.at, true));
  const at = recordedTime(mail[field]) || (event ? recordedTime(event.at, true) : 0);
  if (mail[field] !== undefined || at) out[field] = at;
  // An event can prove an action even if its old timestamp is missing. Expose
  // only that fact, never its note, author or a fabricated replacement date.
  out.MAIL_MILESTONES[field] = !!at || events.length > 0;
 }
 const obj = mail.MAIL_OBJ || {};
 const plugin = Object.prototype.hasOwnProperty.call(SERVICES,obj.serviceType || 'take') ? plugins.get(obj.serviceType || 'take') : null;
 const publicFields = ['title','serviceType','small','medium','large','num','price','referencePrice','urgent','campus','address1','address2','addressPhase',...(plugin ? plugin.publicFields : [])];
 out.MAIL_OBJ = privateAccess ? { ...obj } : Object.fromEntries(publicFields.filter(k => obj[k] !== undefined).map(k => [k,obj[k]]));
 out.mypost = mypost; out.myaccept = myaccept;
 out.status = LABELS[mail.MAIL_STATUS] || '状态未知'; if (mail.MAIL_STATUS === 0 && mail.MAIL_END_TIME < Date.now()) out.status = '已过期';
 out.overdue = ACTIVE.includes(mail.MAIL_STATUS) && mail.MAIL_DUE_TIME > 0 && mail.MAIL_DUE_TIME < Date.now();
 const progressMap = { 0: 0, 1: 1, 4: 2, 2: 3, 9: 4 };
 out.progressStep = progressMap[mail.MAIL_STATUS] === undefined || mail.MAIL_STATUS === 0 && mail.MAIL_END_TIME <= Date.now() ? -1 : progressMap[mail.MAIL_STATUS];
 // This identifies the current stage only; preceding milestones require their
 // own timestamps/events and must not be inferred from an admin-closed order.
 out.progressLabels = ['已发布', '已接单', obj.serviceType === 'buy' ? '已购齐' : '已取件', '已送达', '已完成'];
 return out;
}
module.exports = { ACTIVE, LABELS, SERVICES, text, images, validateForms, requireOpen, project, fail };
