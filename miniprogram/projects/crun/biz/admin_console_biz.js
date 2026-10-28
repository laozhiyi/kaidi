const Admin = require('../../../comm/biz/admin_biz.js');
const Ops = require('./operations_biz.js');
const Address = require('./address_biz.js');
const MailUI = require('./mail_ui_biz.js');

const ROUTES = {
  tenants: '/projects/crun/pages/admin/tenants/admin_tenants',
  home: '/projects/crun/pages/admin/index/home/admin_home',
  orders: '/projects/crun/pages/admin/orders/list/admin_order_list',
  order: '/projects/crun/pages/admin/orders/detail/admin_order_detail',
  feedback: '/projects/crun/pages/admin/feedback/list/admin_feedback_list',
  feedbackDetail: '/projects/crun/pages/admin/feedback/detail/admin_feedback_detail',
  users: '/projects/crun/pages/admin/user/list/admin_user_list',
  user: '/projects/crun/pages/admin/user/detail/admin_user_detail',
  userExport: '/projects/crun/pages/admin/user/export/admin_user_export',
  analytics: '/projects/crun/pages/admin/analytics/admin_analytics',
  settings: '/projects/crun/pages/admin/settings/index/admin_settings',
  service: '/projects/crun/pages/admin/settings/service/admin_service_settings',
  pricing: '/projects/crun/pages/admin/settings/pricing/admin_pricing_settings',
  rules: '/projects/crun/pages/admin/settings/rules/admin_rules_settings',
  aftersales: '/projects/crun/pages/admin/settings/aftersales/admin_aftersales_settings',
  monitor: '/projects/crun/pages/admin/monitor/admin_monitor',
  news: '/projects/crun/pages/admin/news/list/admin_news_list',
  chats: '/projects/crun/pages/admin/customer_service/chat_list/admin_customer_chat_list',
  about: '/projects/crun/pages/admin/setup/about_list/admin_setup_about_list',
  qr: '/projects/crun/pages/admin/setup/qr/admin_setup_qr',
  managers: '/projects/crun/pages/admin/mgr/list/admin_mgr_list',
  password: '/projects/crun/pages/admin/mgr/pwd/admin_mgr_pwd',
  logs: '/projects/crun/pages/admin/mgr/log/admin_log_list',
  export: '/projects/crun/pages/admin/mail/export/admin_mail_export'
};

function url(key, params = {}) {
  if (!Object.prototype.hasOwnProperty.call(ROUTES, key)) throw new Error('管理页面不存在');
  const query = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  return ROUTES[key] + (query ? '?' + query : '');
}
function go(key, params, replace = false) {
  return wx[replace ? 'redirectTo' : 'navigateTo']({ url: url(key, params), fail: Ops.error });
}
function back(key) {
  if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) return wx.navigateBack();
  return go(key, {}, true);
}
function authorize(page, superOnly = false) {
  if (Admin.isAdmin(page, superOnly) !== true) return false;
  if (superOnly && !page.data.isSuperAdmin) return false;
  wx.setNavigationBarColor({ backgroundColor: '#f3f5f9', frontColor: '#000000' });
  return true;
}
function start(page, superOnly = false) {
  page._unloaded = false;
  page._visible = true;
  return authorize(page, superOnly);
}
function hide(page) {
  page._interrupted = !!page.data.loading;
  page._visible = false;
  page._seq = (page._seq || 0) + 1;
}
function showList(page) {
  const wasHidden = page._visible === false;
  page._visible = true;
  if (wasHidden && authorize(page) && (page._dirty || page._interrupted)) {
    page._dirty = false;
    page._interrupted = false;
    return page.load(true, true);
  }
}
function time(value, short = false) {
  if (value === undefined || value === null || value === '') return '—';
  let stamp = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : Date.parse(String(value).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(String(value)) ? '' : '+08:00'));
  if (!Number.isFinite(stamp) || stamp <= 0) return '—';
  const date = new Date(stamp + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) return '—';
  const text = date.toISOString().slice(0, 16).replace('T', ' ');
  return short ? text.slice(5) : text;
}
const STATUS = { 0: '待接单', 1: '已接单', 4: '已取件', 2: '待收货', 3: '异常处理中', 9: '已完成', 99: '已取消' };
const TONES = { 0: 'amber', 1: 'blue', 4: 'blue', 2: 'amber', 3: 'red', 9: 'green', 99: 'muted' };
const ACTIONS = { publish: '发布订单', edit: '修改订单', accept: '接取订单', pickup: '确认取件', deliver: '提交送达凭证', update_proof: '更新送达凭证', complete: '确认完成', confirm: '确认收货', cancel: '取消订单', exception: '上报异常', hold: '管理员介入', resume: '恢复配送', resolve: '处理异常', resolve_resume: '恢复配送', resolve_cancel: '取消订单', resolve_complete: '确认完成', expire: '订单到期关闭', overdue: '发送超时提醒' };
function order(row) {
  const obj = row.MAIL_OBJ || {};
  const progress = MailUI.progress(row);
  return { ...row, MAIL_OBJ: obj, statusLabel: row.status || STATUS[row.MAIL_STATUS] || '状态未知', tone: TONES[row.MAIL_STATUS] || 'muted',
    orderNo: row.MAIL_ID || row._id, deliveryAddress: Address.formatOrderAddress(row), createdText: time(row.MAIL_ADD_TIME), dueText: time(row.MAIL_DUE_TIME), endText: time(row.MAIL_END_TIME), expectText: time(row.MAIL_EXPECT_TIME) || time(row.MAIL_END_TIME),
    priceText: Number.isFinite(Number(obj.price)) ? Number(obj.price).toFixed(2) : '—',
    showProgress: progress.visible, steps: progress.steps,
    history: (row.MAIL_HISTORY || []).filter(Boolean).map((item, index) => ({ ...item, key: item.id || String(index), timeText: time(item.at), label: ACTIONS[item.action] || '更新订单', actorText: ({ admin: '管理员', poster: '发布人', rider: '接单人', system: '系统' })[item.actor] || '系统' })),
    canProcess: [0, 1, 4, 2, 3].includes(row.MAIL_STATUS)
  };
}
function feedback(row) {
  return { ...row, statusLabel: ['待处理', '已处理', '不予处理'][row.FB_STATUS] || '状态未知', tone: ['amber', 'green', 'muted'][row.FB_STATUS] || 'muted',
    ratingStars: row.FB_REVIEW_SCORE >= 1 && row.FB_REVIEW_SCORE <= 5 ? '★'.repeat(row.FB_REVIEW_SCORE) + '☆'.repeat(5 - row.FB_REVIEW_SCORE) : '',
    createdText: time(row.FB_ADD_TIME), repliedText: time(row.FB_REPLY_TIME),
    history: (row.FB_HISTORY || []).filter(Boolean).map((item, index) => ({ ...item, key: String(index), timeText: time(item.at), statusLabel: ['继续跟进', '处理完成', '不予处理'][item.status] || '回复反馈',
      ratingText: item.reviewScore ? '审核评分：' + item.reviewScore + ' 星（' + (item.reviewPoints > 0 ? '+' : '') + item.reviewPoints + ' 分）' : item.previousScore ? '此前的 ' + item.previousScore + ' 星评分已撤销' : '' })) };
}
function user(row) {
  const id = row._id || row.USER_MINI_OPENID || row.USER_ID;
  const status = [0, 1, 8, 9].includes(Number(row.USER_STATUS)) && row.USER_STATUS !== null && row.USER_STATUS !== '' ? Number(row.USER_STATUS) : -1;
  return { ...row, _id: id, userId: id, USER_STATUS: status,
    USER_FORMS: Array.isArray(row.USER_FORMS) ? row.USER_FORMS.filter(item => item && typeof item === 'object').map(item => ({ ...item,
      images: item.type === 'image' ? (Array.isArray(item.val) ? item.val : item.val ? [item.val] : []) : [],
      displayValue: item.val === undefined || item.val === null || item.val === '' ? '未填写' : Array.isArray(item.val) ? item.val.join('、') : String(item.val) })) : [],
    USER_ADD_TIME: time(row.USER_ADD_TIME), USER_LOGIN_TIME: time(row.USER_LOGIN_TIME) === '—' ? '未登录' : time(row.USER_LOGIN_TIME),
    statusLabel: ({ 0: '待审核', 1: '正常', 8: '审核未过', 9: '已停用' })[status] || '状态未知', tone: ({ 0: 'amber', 1: 'green', 8: 'red', 9: 'muted' })[status] || 'muted' };
}

const ROLE_LABELS = { super: '超级管理员', admin: '管理员', service: '客服' };
// 注册资料按固定顺序展示，缺失也占一行写“无”，保证每位用户的详情结构一致。
const REGISTER_FIELDS = [['sex', '性别'], ['college', '学院'], ['sub', '专业'], ['studentId', '学号'], ['campus', '所在校区']];
const COLLECTION_MARKS = ['contacts', 'addresses', 'address', 'commonContact', 'commonContactMobile'];

function plainText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item).join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return '';
  return String(value).trim();
}
function imageList(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(item => typeof item === 'string' && item);
}
/** 详情页专用：固定字段顺序、合并重复的常用联系人，缺失显示“无”。 */
function userProfile(row) {
  const base = user(row || {});
  const forms = base.USER_FORMS.filter(item => typeof item.mark === 'string' && item.mark);
  const map = {};
  forms.forEach(item => { if (!map[item.mark]) map[item.mark] = item; });
  // 资料图片存在 owner-only 的云存储目录，只有服务端换好临时链接的地址能显示；
  // 这里绝不再把 cloud:// 原始 fileID 当图片地址，否则后台只会看到裂图。
  const preview = row && row.USER_FORM_MEDIA && typeof row.USER_FORM_MEDIA === 'object' ? row.USER_FORM_MEDIA : {};
  const previewError = row && row.USER_FORM_MEDIA_ERROR || '图片暂时无法读取，请稍后刷新重试';
  const text = mark => plainText(map[mark] && map[mark].val);
  const raw = mark => imageList(map[mark] && map[mark].val);
  const images = mark => imageList(preview[mark]);
  const contacts = [];
  if (Array.isArray(map.contacts && map.contacts.val)) {
    map.contacts.val.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const name = plainText(item.name), phone = plainText(item.phone);
      if (name || phone) contacts.push({ key: contacts.length, name: name || '无', phone: phone || '无', isDefault: item.isDefault === true });
    });
  }
  if (!contacts.length) {
    const name = text('commonContact'), phone = text('commonContactMobile');
    if (name || phone) contacts.push({ key: 0, name: name || '无', phone: phone || '无', isDefault: true });
  }
  const addresses = [];
  if (Array.isArray(map.addresses && map.addresses.val)) {
    map.addresses.val.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const detail = plainText(item.detail), label = plainText(item.label), note = plainText(item.note);
      if (detail || label) addresses.push({ key: addresses.length, label: label || '无', detail: detail || '无', note: note || '无', isDefault: item.isDefault === true });
    });
  }
  if (!addresses.length && text('address')) addresses.push({ key: 0, label: '无', detail: text('address'), note: '无', isDefault: true });
  const known = new Set([...REGISTER_FIELDS.map(item => item[0]), 'studentCard', 'disclaimer', ...COLLECTION_MARKS]);
  const others = forms.filter(item => !known.has(item.mark)).map(item => {
    const rawList = imageList(item.val);
    const urls = imageList(preview[item.mark]);
    // 老记录可能没有 type 字段，值全是 cloud:// 就当图片处理，避免把文件路径当文字显示。
    const isImage = item.type === 'image' || (rawList.length > 0 && rawList.every(value => value.startsWith('cloud://')));
    return {
      key: item.mark, label: item.title || item.mark, images: isImage ? urls : [],
      displayValue: isImage ? (urls.length ? '' : previewError) : (plainText(item.val) || '无')
    };
  });
  const role = ['super', 'admin', 'service'].includes(base.USER_ROLE) ? base.USER_ROLE : '';
  return {
    ...base, role, roleLabel: ROLE_LABELS[role] || '无',
    roleTime: role ? time(base.USER_ROLE_TIME) : '—',
    registers: REGISTER_FIELDS.map(([mark, label]) => ({ key: mark, label, value: text(mark) || '无' })),
    studentCard: images('studentCard'),
    studentCardNote: raw('studentCard').length > 0 && !images('studentCard').length ? previewError : '',
    disclaimer: map.disclaimer ? (map.disclaimer.val === true ? '已同意' : '未同意') : '未同意',
    contacts, addresses, others
  };
}
function message(error) { return error && (error.msg || error.message) || '网络连接失败，请稍后重试'; }
function unique(rows) {
  const seen = new Set();
  return rows.filter(row => { if (seen.has(row._id)) return false; seen.add(row._id); return true; });
}

// A detail page may change a record on any loaded page. Refresh that same range
// in bounded batches, retaining the filters, page count and scroll position.
async function loadList(page, route, params, format, reset = true, preserve = false) {
  if (!authorize(page)) return;
  if (!reset && (page.data.loading || !page.data.hasMore)) return;
  const seq = page._seq = (page._seq || 0) + 1;
  const first = reset ? 1 : page.data.page + 1;
  const last = reset && preserve ? Math.max(1, page.data.page) : first;
  page.setData({ loading: true, error: '', refreshing: preserve });
  try {
    const results = [];
    for (let next = first; next <= last; next += 4) {
      if (!page._visible || seq !== page._seq) return;
      const batch = Array.from({ length: Math.min(4, last - next + 1) }, (_, i) => Ops.get(route, { ...params, page: next + i }));
      results.push(...await Promise.all(batch));
    }
    if (!page._visible || seq !== page._seq) return;
    if (results.some(result => !result || !Array.isArray(result.list))) throw new Error('列表响应无效，请重试');
    const tail = results[results.length - 1];
    const rows = results.reduce((all, result) => all.concat(result.list), []).map(format);
    page.setData({ list: unique(reset ? rows : page.data.list.concat(rows)), page: last, hasMore: tail.hasMore === undefined ? last * Number(tail.size || 20) < Number(tail.total || 0) : !!tail.hasMore, total: Number(tail.total || 0), condition: tail.condition || '' }, () => {
      if (preserve) wx.pageScrollTo({ scrollTop: page._scrollTop || 0, duration: 0 });
    });
  } catch (error) {
    if (page._visible && seq === page._seq) page.setData({ error: message(error) });
  } finally {
    if (page._visible && seq === page._seq) page.setData({ loading: false, refreshing: false });
  }
}
function openDetail(page, key, id) {
  if (!id || page._opening) return;
  page._opening = true;
  return wx.navigateTo({ url: url(key, { id }), events: { changed: () => { page._dirty = true; if (page._visible && !page._unloaded) { page._dirty = false; page.load(true, true); } } },
    fail: Ops.error, complete: () => { page._opening = false; } });
}
function changed(page) {
  if (typeof page.getOpenerEventChannel === 'function') {
    const channel = page.getOpenerEventChannel();
    if (channel && channel.emit) channel.emit('changed');
  }
}
function confirm(title, content) {
  return new Promise(resolve => wx.showModal({ title, content, confirmText: '确认提交', confirmColor: '#397bc8', success: result => resolve(!!result.confirm), fail: () => resolve(false) }));
}
function summary(data) {
  const total = Number(data.total || 0);
  const states = [['待接单', 'waiting', 0, 'amber'], ['已接单', 'accepted', 1, 'blue'], ['已取件', 'picked', 4, 'blue'], ['待收货', 'confirming', 2, 'amber'], ['异常中', 'exceptions', 3, 'red'], ['已完成', 'completed', 9, 'green'], ['已取消', 'cancelled', 99, 'muted']];
  const rows = states.map(([label, key, status, tone]) => ({ label, key, status, tone, value: Number(data[key] || 0), percent: total ? Math.round(Number(data[key] || 0) / total * 1000) / 10 : 0 }));
  return { ...data, rows, active: Number(data.waiting || 0) + Number(data.delivering || 0) + Number(data.confirming || 0) + Number(data.exceptions || 0), completionRate: total ? (Number(data.completed || 0) / total * 100).toFixed(1) : '0.0', updatedText: time(Date.now()) };
}
/** 当前后台角色：root（初始管理员）/ super / admin / service / '' */
function adminRole() { return Admin.getAdminRole(); }
/** 清掉本机后台会话（主动退出后台或会话失效后使用） */
function clearAdminToken() { Admin.clearAdminToken(); }
/** 能否调整该角色的账号（与后端 Roles.canManage 一致，仅用于隐藏按钮） */
function canManageRole(role) { return Admin.canManageRole(String(role || '')); }
/** 能否把账号设成该角色，空串表示取消后台权限 */
function canGrantRole(role) { return Admin.canGrantRole(String(role || '')); }

module.exports = { ROUTES, url, go, back, authorize, start, hide, showList, time, order, feedback, user, userProfile, message, loadList, openDetail, changed, confirm, summary, adminRole, clearAdminToken, canManageRole, canGrantRole };
