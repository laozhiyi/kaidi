'use strict';
// Presentation only. Authorization, prices and order transitions remain server-enforced.
const Address = require('./address_biz.js');
const STATUS = {
 0: { title: '等待骑手接单', note: '订单已发布，接单后将为你取送', icon: 'time', tone: 'blue' },
 1: { title: '等待骑手取件', note: '骑手已接单，正在前往快递点取件', icon: 'time', tone: 'blue' },
 4: { title: '正在为你配送', note: '骑手已取件，正在送往收件地址，请保持电话畅通', icon: 'deliver', tone: 'blue' },
 2: { title: '等待确认收货', note: '送达凭证已提交，请核对物品后确认', icon: 'roundcheck', tone: 'green' },
 3: { title: '异常处理中', note: '订单已进入异常处理，请关注处理进展', icon: 'info', tone: 'amber' },
 9: { title: '订单已完成', note: '这一趟已顺利结束，感谢你的信任', icon: 'roundcheck', tone: 'green' },
 99: { title: '订单已取消', note: '本次代取已结束，可重新发布订单', icon: 'close', tone: 'muted' }
};
function progress(mail, now = Date.now()) {
 const status = mail.MAIL_STATUS == null ? -1 : Number(mail.MAIL_STATUS);
 const expired = status === 0 && Number(mail.MAIL_END_TIME) > 0 && Number(mail.MAIL_END_TIME) <= now;
 const index = { 1: 0, 4: 2, 2: 3, 9: 4 }[status];
 const step = expired || index === undefined ? -1 : index;
 return { step, visible: !expired && (status === 0 || step >= 0),
  steps: ['已接单', '已取件', '配送中', '待收货', '已完成'].map((label, index) => ({ label, index, done: step >= index, current: step === index })) };
}
function time(value) {
 if (typeof value === 'string' && /^\d{4}[-/]\d{2}[-/]\d{2} \d{2}:\d{2}/.test(value)) return value.slice(0, 16).replace(/\//g, '-');
 const at = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : typeof value === 'string' ? Date.parse(value) : NaN;
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
 else if (participant && mail.myaccept && status === 1) { primary = 'pickup'; primaryLabel = '已取件'; }
 else if (participant && mail.myaccept && status === 4) { primary = 'deliver'; primaryLabel = '已送达'; }
 else if (participant && mail.mypost && status === 2) { primary = 'confirm'; primaryLabel = '确认收货'; }
 else if (participant && status === 9 && (mail.MAIL_CAN_REVIEW || mail.MAIL_REVIEWED)) { primary = 'review'; primaryLabel = mail.MAIL_REVIEWED ? '查看我的评价' : '评价对方'; }
 else if (phone) { primary = 'contact'; primaryLabel = mail.mypost ? '联系骑手' : '联系发布者'; }
 const actions = { overdue: '已超过预计送达时间', archive: '订单已归档', expire: '已超过接单截止时间', hold: '管理员已介入', resume: '配送已恢复', admin_cancel: '管理员已取消订单', admin_finish: '管理员已完结订单', publish: '订单已发布', accept: '骑手已接单', pickup: '骑手已取件，开始配送', edit: '订单信息已更新', deliver: '骑手已提交送达凭证', update_proof: '骑手已更新送达凭证', finish: '已确认收货', confirm: '已确认收货', cancel: '订单已取消', exception: '已提交配送异常', resolve: '异常处理已更新' };
 const history = mail.mypost && Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY.filter(x => x && typeof x === 'object').map((x, i) => ({
  id: x.id || String(i), title: actions[x.action] || '订单状态已更新', note: x.note || '',
  actor: x.actor === 'admin' ? '管理员' : x.actor === 'poster' ? '发布者' : x.actor === 'rider' ? '骑手' : '系统', time: time(x.at) || '时间待确认'
 })).reverse() : [];
 const title = mail.myaccept && status === 1 ? '请前往快递点取件' : mail.myaccept && status === 4 ? '配送进行中' : mail.myaccept && status === 2 ? '等待发布者确认' : state.title;
 const note = !participant && status === 0 && !expired ? '接单后可查看联系人信息、取件码和截图' : mail.myaccept && status === 1 ? '取齐本单包裹后，点击“已取件”开始配送' : mail.myaccept && status === 4 ? '送到收件地址后，点击“已送达”填写说明并上传照片' : mail.myaccept && status === 2 ? '已通知发布者核对，请等待对方确认收货' : state.note;
 return { ...state, title, note, participant, expired, status, legacyPayment, fee: Number.isFinite(fee) && fee >= 0 ? fee.toFixed(2) : '—', packages, pickupItems,
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
