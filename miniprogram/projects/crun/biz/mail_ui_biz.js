'use strict';
// Presentation only. Authorization, prices and order transitions remain server-enforced.
const STATUS = {
 0: { title: '等待骑手接单', note: '订单已发布，接单后将为你取送', icon: 'time', tone: 'blue', step: 0 },
 1: { title: '正在为你配送', note: '骑手已接单，请保持电话畅通', icon: 'deliver', tone: 'blue', step: 1 },
 2: { title: '等待确认收货', note: '送达凭证已提交，请核对物品后确认', icon: 'roundcheck', tone: 'green', step: 2 },
 3: { title: '异常处理中', note: '订单已进入异常处理，请关注处理进展', icon: 'info', tone: 'amber', step: -1 },
 9: { title: '订单已完成', note: '这一趟已顺利结束，感谢你的信任', icon: 'roundcheck', tone: 'green', step: 3 },
 99: { title: '订单已取消', note: '本次代取已结束，可重新发布订单', icon: 'close', tone: 'muted', step: -1 }
};
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
function detail(mail, now = Date.now()) {
 const obj = mail.MAIL_OBJ || {}, status = mail.MAIL_STATUS == null ? -1 : Number(mail.MAIL_STATUS);
 const participant = !!(mail.mypost || mail.myaccept);
 const legacyPayment = mail.MAIL_PAYMENT_MODE !== 'offline';
 const expired = status === 0 && Number(mail.MAIL_END_TIME) > 0 && Number(mail.MAIL_END_TIME) <= now;
 const state = expired ? { title: '订单已过期', note: '已超过接单截止时间，本单不再接受接取', icon: 'time', tone: 'muted', step: -1 }
  : STATUS[status] || { title: '订单状态待确认', note: '请刷新订单或联系校区客服', icon: 'info', tone: 'muted', step: -1 };
 const fee = obj.price == null ? Number(mail.MAIL_TOTAL_FEE) / 100 : Number(obj.price);
 const packages = ['small', 'medium', 'large'].map((key, i) => ({ key, label: ['小件', '中件', '大件'][i], count: Number(obj[key]) || 0 })).filter(x => x.count > 0);
 const phone = participant ? (mail.mypost ? mail.acceptUser && mail.acceptUser.USER_MOBILE : obj.tel) : '';
 const contactName = participant ? (mail.mypost ? mail.acceptUser && mail.acceptUser.USER_NAME : obj.poster) : '';
 let primary = 'orders', primaryLabel = '返回订单列表';
 if (participant && mail.mypost && status === 0 && !expired && !legacyPayment) { primary = 'edit'; primaryLabel = '编辑订单'; }
 else if (participant && mail.myaccept && status === 1) { primary = 'deliver'; primaryLabel = '提交送达凭证'; }
 else if (participant && mail.mypost && status === 2) { primary = 'confirm'; primaryLabel = '确认收到物品'; }
 else if (phone) { primary = 'contact'; primaryLabel = mail.mypost ? '联系骑手' : '联系发布者'; }
 const actions = { overdue: '已超过预计送达时间', archive: '订单已归档', expire: '已超过接单截止时间', hold: '管理员已介入', resume: '配送已恢复', admin_cancel: '管理员已取消订单', admin_finish: '管理员已完结订单', publish: '订单已发布', accept: '骑手已接单', edit: '订单信息已更新', deliver: '骑手已提交送达凭证', finish: '已确认收货', confirm: '已确认收货', cancel: '订单已取消', exception: '已提交配送异常', resolve: '异常处理已更新' };
 const history = participant && Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY.filter(x => x && typeof x === 'object').map((x, i) => ({
  id: x.id || String(i), title: actions[x.action] || '订单状态已更新', note: x.note || '',
  actor: x.actor === 'admin' ? '管理员' : x.actor === 'poster' ? '发布者' : x.actor === 'rider' ? '骑手' : '系统', time: time(x.at) || '时间待确认'
 })).reverse() : [];
 const title = mail.myaccept && status === 1 ? '配送进行中' : mail.myaccept && status === 2 ? '等待发布者确认' : state.title;
 const note = !participant && status === 0 && !expired ? '接单后可查看完整取送信息' : mail.myaccept && status === 1 ? '请及时取件配送，送达后上传凭证' : mail.myaccept && status === 2 ? '已通知发布者核对，请等待对方确认收货' : state.note;
 return { ...state, title, note, participant, expired, status, legacyPayment, fee: Number.isFinite(fee) && fee >= 0 ? fee.toFixed(2) : '—', packages,
  count: packages.reduce((sum, x) => sum + x.count, 0) || Number(obj.num) || 1,
  role: mail.mypost ? '我发布的' : mail.myaccept ? '我接取的' : '订单详情',
  steps: ['已发布', '配送中', '待收货', '已完成'].map((label, index) => ({ label, index, done: state.step >= index, current: state.step === index })),
  phone: phone || '', contactName: contactName || (mail.mypost ? (status === 0 && !expired ? '等待骑手接单' : '暂无骑手信息') : '发布者'), contactRole: mail.mypost ? '接单骑手' : '订单发布者',
  createdAt: time(mail.MAIL_ADD_TIME), endAt: time(mail.MAIL_END_TIME) || time(mail.end2), dueAt: time(mail.MAIL_DUE_TIME), deliveredAt: time(mail.MAIL_DELIVERED_TIME),
  primary, primaryLabel, history, canException: participant && [1, 2].includes(status), canCancel: !!mail.mypost && status === 0
 };
}
module.exports = { time, service, detail };
