'use strict';
// Presentation only. Authorization, prices and order transitions remain server-enforced.
const Address = require('./address_biz.js');
const STATUS = {
 0: { title: '等待骑手接单', note: '订单已发布，接单后将为你取送', icon: 'time', tone: 'blue' },
 1: { title: '等待骑手取件', note: '骑手已接单，等待确认取件', icon: 'time', tone: 'blue' },
 4: { title: '正在为你配送', note: '骑手已确认取件，等待送达，请保持电话畅通', icon: 'deliver', tone: 'blue' },
 2: { title: '等待确认收货', note: '送达凭证已提交，请核对物品后确认', icon: 'roundcheck', tone: 'green' },
 3: { title: '异常处理中', note: '订单已进入异常处理，请关注处理进展', icon: 'info', tone: 'amber' },
 9: { title: '订单已完成', note: '订单已结束，可查看实际履约记录', icon: 'roundcheck', tone: 'green' },
 99: { title: '订单已取消', note: '本次代取已结束，可重新发布订单', icon: 'close', tone: 'muted' }
};
function progress(mail, now = Date.now()) {
 const status = mail.MAIL_STATUS == null ? -1 : Number(mail.MAIL_STATUS);
 const expired = status === 0 && Number(mail.MAIL_END_TIME) > 0 && Number(mail.MAIL_END_TIME) <= now;
 const index = { 0: 0, 1: 1, 4: 2, 2: 3, 9: 4 }[status];
 const step = expired || index === undefined ? -1 : index;
 const history = (Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY : []).filter(item => item && typeof item === 'object');
 const adminCompleted = status === 9 && ((mail.MAIL_EXCEPTION || {}).resolution === 'complete'
  || history.some(item => item.actor === 'admin' && (item.action === 'resolve' && Number(item.status) === 9 || ['admin_finish', 'resolve_complete'].includes(item.action))));
 const buy = (mail.MAIL_OBJ || {}).serviceType === 'buy';
 const milestones = [
  ['已发布', '待发布', 'MAIL_ADD_TIME', ['publish']],
  ['已接单', '待接单', 'MAIL_ACCEPT_TIME', ['accept']],
  [buy ? '已购齐' : '已取件', buy ? '待购买' : '待取件', 'MAIL_PICKUP_TIME', ['pickup']],
  ['已送达', '待送达', 'MAIL_DELIVERED_TIME', ['deliver']],
  [adminCompleted ? '已完结' : '已完成', '待完成', 'MAIL_OVER_TIME', ['confirm', 'finish', 'complete', 'admin_finish', 'resolve_complete']]
 ];
 // A terminal status does not prove intermediate actions happened: an admin
 // can close an order before pickup. Only records or the current stage count.
 const steps = milestones.map(([label, pendingLabel, field, actions], index) => {
  const events = history.filter(item => actions.includes(item.action) || index === 4 && item.action === 'resolve' && Number(item.status) === 9);
  const timeText = time(mail[field]) || events.map(item => time(item.at)).find(Boolean) || '';
  const current = step === index;
  const done = !!timeText || events.length > 0 || (mail.MAIL_MILESTONES || {})[field] === true || current;
  const unrecorded = !done && index < step;
  const displayLabel = done ? label : unrecorded ? ['发布', '接单', buy ? '购齐' : '取件', '送达', '完成'][index] : pendingLabel;
  return { label, displayLabel, pendingLabel, index, done, current, timeText, dateText: timeText.slice(5, 10), clockText: timeText.slice(11),
   recordText: done ? (timeText ? '' : '时间未记录') : unrecorded ? '未记录' : '' };
 });
 steps.forEach((item, index) => { item.connected = index > 0 && item.done && steps[index - 1].done; });
 return { step, visible: step >= 0, adminCompleted, steps };
}
function time(value) {
 let at = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
 if (typeof value === 'string') {
  const local = value.match(/^(\d{4}[-/]\d{2}[-/]\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/);
  const iso = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (local || iso) {
   const wall = local ? local[1].replace(/\//g, '-') + 'T' + local[2] + ':' + (local[3] || '00') : iso[1] + ':' + (iso[2] || '00');
   const calendar = new Date(wall + 'Z');
   if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 19) !== wall) return '';
   at = Date.parse(local ? wall + '+08:00' : value);
  }
 }
 if (!Number.isFinite(at) || at <= 0) return '';
 const date = new Date(at + 8 * 3600000);
 return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : '';
}
function service(config, now = Date.now()) {
 if (!config) return { kind: 'loading', title: '正在获取服务状态', description: '', hours: '', canPublish: false };
 const validHours = Number.isInteger(config.openHour) && Number.isInteger(config.closeHour) && config.openHour >= 0 && config.closeHour <= 24 && config.openHour < config.closeHour;
 const pad = n => String(n).padStart(2, '0');
 const hours = validHours ? pad(config.openHour) + ':00–' + pad(config.closeHour) + ':00' : '';
 if (config.enabled !== true) return { kind: 'paused', title: '校区暂时停止接单', hours,
  description: '管理员已暂停新订单。你可以先填写信息，或联系校区客服了解恢复时间。', canPublish: false };
 if (config.enforceBusinessHours !== true) return { kind: 'open', title: '正常接单', hours: '全天可发布',
  description: '填写取送信息，发布后等待骑手接单', canPublish: true };
 const hour = new Date(now + 8 * 3600000).getUTCHours();
 if (!validHours || !Number.isFinite(hour)) return { kind: 'paused', title: '营业时间待确认', hours,
  description: '校区营业配置暂不可用，请刷新或联系管理员。', canPublish: false };
 if (hour < config.openHour || hour >= config.closeHour) return { kind: 'closed', title: '休息中，营业后可发布', hours,
  description: '当前不在本校区营业时间，可以先填写信息，营业后再发布。', canPublish: false };
 return { kind: 'open', title: '正常接单', description: '填写取送信息，发布后等待骑手接单', hours, canPublish: true };
}
function receipt(mail, now = Date.now()) {
 const status = mail.MAIL_STATUS == null ? -1 : Number(mail.MAIL_STATUS), poster = !!mail.mypost;
 const expired = status === 0 && Number(mail.MAIL_END_TIME) > 0 && Number(mail.MAIL_END_TIME) <= now;
 const hints = {
  0: '等待骑手接单，送达后可确认收货',
  1: '骑手已接单，取件送达后可确认收货',
  2: '请核对包裹、数量和外观后确认收货',
  3: '订单异常处理中，处理完成并送达后可确认收货',
  4: '骑手正在配送，送达后可确认收货',
  9: '订单已完成，无需重复确认收货',
  99: '订单已取消，无法确认收货'
 };
 return { visible: poster && ![9, 99].includes(status), canConfirm: poster && status === 2,
  hint: !poster ? '仅订单发布人可以确认收货' : expired ? '订单已过期，无法确认收货，请重新发布订单' : hints[status] || '订单状态待更新，请刷新后重试' };
}
function detail(mail, now = Date.now()) {
 const obj = mail.MAIL_OBJ || {}, status = mail.MAIL_STATUS == null ? -1 : Number(mail.MAIL_STATUS);
 const serviceType = obj.serviceType || 'take';
 const serviceName = { take: '快递代取', send: '物品代送', buy: '商品代买' }[serviceType] || '快递代取';
 const participant = !!(mail.mypost || mail.myaccept);
 const legacyPayment = mail.MAIL_PAYMENT_MODE !== 'offline';
 const expired = status === 0 && Number(mail.MAIL_END_TIME) > 0 && Number(mail.MAIL_END_TIME) <= now;
 const state = expired ? { title: '订单已过期', note: '已超过接单截止时间，本单不再接受接取', icon: 'time', tone: 'muted', step: -1 }
  : STATUS[status] || { title: '订单状态待确认', note: '请刷新订单或联系校区客服', icon: 'info', tone: 'muted', step: -1 };
 const orderProgress = progress(mail, now);
 const fee = obj.price == null ? Number(mail.MAIL_TOTAL_FEE) / 100 : Number(obj.price);
 const packages = ['small', 'medium', 'large'].map((key, i) => ({ key, label: ['小件', '中件', '大件'][i], count: Number(obj[key]) || 0 })).filter(x => x.count > 0);
 const pickupItems = participant && Array.isArray(obj.packages) ? obj.packages.map((item, index) => item && typeof item === 'object' ? ({
  index, label: '第' + (index + 1) + '件 · ' + ({ small: '小件', medium: '中件', large: '大件' }[item.type] || '包裹'),
  pickupPoint: item.pickupPoint || obj.address1 || '请联系发布者确认', code: item.code || '', note: item.note || '',
  images: mail.MAIL_MEDIA && mail.MAIL_MEDIA.packages && mail.MAIL_MEDIA.packages[index] || []
 }) : null).filter(Boolean) : [];
 const phone = participant ? (mail.mypost ? mail.acceptUser && mail.acceptUser.USER_MOBILE : obj.tel) : '';
 const contactName = participant ? (mail.mypost ? mail.acceptUser && mail.acceptUser.USER_NAME : obj.poster) : '';
 let primary = 'orders', primaryLabel = '返回订单列表';
 if (participant && mail.mypost && status === 0 && !expired && !legacyPayment) { primary = 'edit'; primaryLabel = '编辑订单'; }
 else if (participant && mail.myaccept && status === 1) { primary = 'pickup'; primaryLabel = serviceType === 'buy' ? '已购齐' : '已取件'; }
 else if (participant && mail.myaccept && status === 4) { primary = 'deliver'; primaryLabel = '已送达'; }
 else if (participant && mail.mypost && status === 2) { primary = 'confirm'; primaryLabel = '确认收货'; }
 else if (participant && status === 9 && (mail.MAIL_CAN_REVIEW || mail.MAIL_REVIEWED)) { primary = 'review'; primaryLabel = mail.MAIL_REVIEWED ? '查看我的评价' : '评价对方'; }
 else if (phone) { primary = 'contact'; primaryLabel = mail.mypost ? '联系骑手' : '联系发布者'; }
 const actions = { overdue: '已超过预计送达时间', archive: '订单已归档', expire: '已超过接单截止时间', hold: '管理员已介入', resume: '配送已恢复', admin_cancel: '管理员已取消订单', admin_finish: '管理员已完结订单', publish: '订单已发布', accept: '骑手已接单', pickup: '骑手已取件，开始配送', edit: '订单信息已更新', deliver: '骑手已提交送达凭证', update_proof: '骑手已更新送达凭证', finish: '已确认收货', confirm: '已确认收货', cancel: '订单已取消', exception: '已提交配送异常', resolve: '异常处理已更新' };
 const history = mail.mypost && Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY.filter(x => x && typeof x === 'object').map((x, i) => ({
  id: x.id || String(i), title: actions[x.action] || '订单状态已更新', note: x.note || '',
  actor: x.actor === 'admin' ? '管理员' : x.actor === 'poster' ? '发布者' : x.actor === 'rider' ? '骑手' : '系统', time: time(x.at) || '时间待确认'
 })).reverse() : [];
 let title = mail.myaccept && status === 1 ? '请前往快递点取件' : mail.myaccept && status === 4 ? '配送进行中' : mail.myaccept && status === 2 ? '等待发布者确认' : state.title;
 let note = !participant && status === 0 && !expired ? '接单后可查看联系人信息、取件码和截图' : mail.myaccept && status === 1 ? '取齐本单包裹后，点击“已取件”开始配送' : mail.myaccept && status === 4 ? '送到收件地址后，点击“已送达”填写说明并上传照片' : mail.myaccept && status === 2 ? '已通知发布者核对，请等待对方确认收货' : state.note;
 if (orderProgress.adminCompleted) { title = '管理员已完结订单'; note = '本单由管理员处理完结，具体情况请查看处理记录'; }
 if (serviceType !== 'take') {
  if (status === 1) { title = serviceType === 'buy' ? (mail.myaccept ? '请前往购买商品' : '等待骑手购买') : (mail.myaccept ? '请前往取件地址' : '等待骑手取件'); note = serviceType === 'buy' ? '请按要求购买，超出预算先联系发布者；购齐后开始配送' : '请按填写的取件位置交接物品，取齐后开始配送'; }
  if (!participant && status === 0 && !expired) note = '接单后可查看联系人信息并开始服务';
  if (status === 99) note = '本次服务已结束，可重新发布订单';
 }
 return { ...state, title, note, serviceType, serviceName, feeLabel: serviceType === 'take' ? '代取费用' : serviceType === 'send' ? '代送费用' : '跑腿费（不含商品款）', participant, expired, status, legacyPayment, fee: Number.isFinite(fee) && fee >= 0 ? fee.toFixed(2) : '—', packages, pickupItems,
  count: packages.reduce((sum, x) => sum + x.count, 0) || Number(obj.num) || 1,
  role: mail.mypost ? '我的发布' : mail.myaccept ? '我的接单' : '订单详情',
  step: orderProgress.step, showProgress: orderProgress.visible, steps: orderProgress.steps, deliveryAddress: Address.formatOrderAddress(mail),
  phone: phone || '', contactName: contactName || (mail.mypost ? (status === 0 && !expired ? '等待骑手接单' : '暂无骑手信息') : '发布者'), contactRole: mail.mypost ? '接单骑手' : '订单发布者',
  createdAt: time(mail.MAIL_ADD_TIME), endAt: time(mail.MAIL_END_TIME) || time(mail.end2), dueAt: time(mail.MAIL_DUE_TIME), deliveredAt: time(mail.MAIL_DELIVERED_TIME),
  canUpdateProof: !!mail.myaccept && status === 2 && !!mail.MAIL_DELIVERY_PROOF, proofUpdatedAt: time(mail.MAIL_DELIVERY_PROOF && mail.MAIL_DELIVERY_PROOF.updatedAt),
  primary, primaryLabel, receipt: receipt(mail, now), history, canException: participant && [1, 2, 4].includes(status), canCancel: !!mail.mypost && status === 0
 };
}
module.exports = { time, service, receipt, progress, detail, deliveryAddress: Address.formatOrderAddress };
