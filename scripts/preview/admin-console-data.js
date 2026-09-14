// Local sample records only. This adapter is never imported by the mini program.
const sampleNow = Date.now();
const sampleConfig = {
  enabled: true, paymentMode: 'offline', smallPrice: 1.5, mediumPrice: 3, largePrice: 5,
  maxPackages: 20, maxActiveOrders: 3, maxOpenOrders: 10, deliveryMinutes: 120,
  urgentMinutes: 60, urgentEnabled: false, registrationReview: true,
  openHour: 8, closeHour: 22, campuses: ['育才校区', '王城校区', '雁山校区'],
  offlineNotice: '费用由双方线下协商结算，平台不代收、不担保；请勿提前向陌生人转账。'
};
const sampleUsers = ['林同学', '周同学', '陈同学', '许同学'].map((name, index) => ({
  _id: 'sample-user-' + (index + 1), USER_MINI_OPENID: 'sample-user-' + (index + 1),
  USER_NAME: name, USER_MOBILE: '', USER_STATUS: [1, 1, 0, 9][index],
  USER_ADD_TIME: '2026-09-12 09:30', USER_LOGIN_TIME: '2026-09-14 10:16',
  USER_FORMS: [{ key: 'campus', title: '所在校区', type: 'select', val: sampleConfig.campuses[index % 3] },
    { key: 'note', title: '注册说明', type: 'text', val: index === 2 ? '申请成为校内代取人员' : '校内师生' }]
}));
const sampleOrders = [0, 1, 4, 3, 9, 99, 2, 0].map((status, index) => ({
  _id: 'sample-order-' + (index + 1), MAIL_ID: 'KD20260914' + String(index + 1).padStart(4, '0'), MAIL_STATUS: status,
  MAIL_ADD_TIME: sampleNow - (index + 1) * 600000, MAIL_END_TIME: sampleNow + 7200000,
  MAIL_DUE_TIME: sampleNow + (index === 3 ? -1800000 : 5400000), MAIL_PAYMENT_MODE: 'offline',
  MAIL_OBJ: { title: ['菜鸟驿站取件', '图书馆资料代取', '南门快递代取', '包裹送错楼栋', '教学楼资料配送', '宿舍快递代取', '中通包裹代取', '北门快递代取'][index],
    campus: sampleConfig.campuses[index % 3], num: index % 2 + 1, small: index % 2 + 1, medium: 0, large: 0,
    price: [1.5, 3, 3, 1.5, 5, 3, 3, 1.5][index], address1: '校内菜鸟驿站 · 3 号货架', address2: '学生宿舍 8 栋一楼',
    code: '样例 3-08-2145', poster: '林同学', tel: '', desc: '到楼下后请通过订单联系我，谢谢。', urgent: false },
  poster: { id: sampleUsers[0]._id, name: sampleUsers[0].USER_NAME, phone: '' },
  rider: [1, 4, 3, 2, 9].includes(status) ? { id: sampleUsers[1]._id, name: sampleUsers[1].USER_NAME, phone: '' } : null,
  MAIL_MEDIA: { pickup: [], proof: [], exception: [] },
  MAIL_EXCEPTION: status === 3 ? { reason: '送达位置不一致', note: '接单人放在相邻楼栋，双方正在核对具体位置。', previousStatus: 4 } : null,
  MAIL_HISTORY: [{ action: 'publish', actor: 'poster', at: sampleNow - 4800000 },
    ...([1, 4, 3, 2, 9].includes(status) ? [{ action: 'accept', actor: 'rider', at: sampleNow - 4200000 }] : []),
    ...([4, 3, 2, 9].includes(status) ? [{ action: 'pickup', actor: 'rider', at: sampleNow - 2400000 }] : []),
    ...(status === 3 ? [{ action: 'exception', actor: 'poster', at: sampleNow - 900000, note: '宿舍楼下暂未找到包裹，请协助核实。' }] : [])],
  overdue: index === 3
}));
const sampleFeedback = [
  { _id: 'sample-feedback-1', FB_TITLE: '包裹未在约定地点找到', FB_CONTENT: '订单显示已取件，但宿舍楼下没有找到包裹，希望协助联系接单同学核对位置。', FB_TYPE: '订单投诉', FB_STATUS: 0, FB_ORDER_ID: 'sample-order-4' },
  { _id: 'sample-feedback-2', FB_TITLE: '建议增加雨天取件提醒', FB_CONTENT: '下雨时可以提醒接单同学携带防水袋，减少纸箱淋湿的情况。', FB_TYPE: '功能建议', FB_STATUS: 0, FB_ORDER_ID: '' },
  { _id: 'sample-feedback-3', FB_TITLE: '校区服务入口咨询', FB_CONTENT: '想确认王城校区是否已开通服务。', FB_TYPE: '其他反馈', FB_STATUS: 1, FB_ORDER_ID: '' }
].map((record, index) => ({ ...record, FB_USER_NAME: sampleUsers[index].USER_NAME, FB_CONTACT: '站内回复', FB_VERSION: 0,
  FB_ADD_TIME: sampleNow - (index + 1) * 900000, FB_IMG_PREVIEW: [],
  FB_HISTORY: index === 2 ? [{ status: 1, at: sampleNow - 120000, reply: '王城校区已开通，可在发布订单时选择该校区。' }] : [] }));
const sampleReports = {};
const copySample = value => JSON.parse(JSON.stringify(value));
function samplePage(rows, params) {
  const size = 3, page = Number(params.page || 1);
  return { list: copySample(rows.slice((page - 1) * size, page * size)), page, size, total: rows.length, hasMore: page * size < rows.length, condition: JSON.stringify({ status: params.sortVal, search: params.search }) };
}
function sampleOverview() {
  const count = status => sampleOrders.filter(row => row.MAIL_STATUS === status).length;
  return { total: sampleOrders.length, todayOrders: sampleOrders.length, todayCompleted: count(9), completed: count(9),
    waiting: count(0), accepted: count(1), picked: count(4), delivering: count(1) + count(4), confirming: count(2), exceptions: count(3), cancelled: count(99),
    users: sampleUsers.length, pendingUsers: sampleUsers.filter(row => row.USER_STATUS === 0).length,
    overdue: sampleOrders.filter(row => row.overdue && [1, 2, 3, 4].includes(row.MAIL_STATUS)).length,
    complaints: sampleFeedback.filter(row => row.FB_STATUS === 0).length, failedNotifications: 0 };
}
async function sampleRequest(route, params = {}) {
  const search = String(params.search || '').trim().toLowerCase();
  if (route === 'admin/operations_overview') return sampleOverview();
  if (route === 'admin/operations_config') return copySample(sampleConfig);
  if (route === 'admin/operations_config_save') { Object.assign(sampleConfig, copySample(params.value)); return copySample(sampleConfig); }
  if (route === 'admin/operations_orders') {
    let rows = sampleOrders.filter(row => (params.status < 0 || params.status === undefined || row.MAIL_STATUS === Number(params.status)) &&
      (!params.campus || row.MAIL_OBJ.campus === params.campus) && (!params.overdue || row.overdue) &&
      (!search || (row.MAIL_ID + row.MAIL_OBJ.title).toLowerCase().includes(search)));
    rows.sort((a, b) => params.sort === 'oldest' ? a.MAIL_ADD_TIME - b.MAIL_ADD_TIME : params.sort === 'price_high' ? b.MAIL_OBJ.price - a.MAIL_OBJ.price : params.sort === 'price_low' ? a.MAIL_OBJ.price - b.MAIL_OBJ.price : b.MAIL_ADD_TIME - a.MAIL_ADD_TIME);
    return samplePage(rows, params);
  }
  if (route === 'admin/operations_order') return copySample(sampleOrders.find(row => row._id === params.id) || null);
  if (route === 'admin/operations_hold' || route === 'admin/operations_resolve') {
    const order = sampleOrders.find(row => row._id === params.id);
    if (!order) throw new Error('示例订单不存在');
    if (route.endsWith('_hold')) { order.MAIL_EXCEPTION = { reason: '管理员介入', note: params.note, previousStatus: order.MAIL_STATUS }; order.MAIL_STATUS = 3; }
    else { order.MAIL_STATUS = params.resolution === 'cancel' ? 99 : params.resolution === 'complete' ? 9 : order.MAIL_EXCEPTION.previousStatus || 1; order.MAIL_EXCEPTION.result = params.note; if ([9, 99].includes(order.MAIL_STATUS)) order.overdue = false; }
    order.MAIL_HISTORY.push({ action: route.endsWith('_hold') ? 'hold' : 'resolve_' + params.resolution, actor: 'admin', at: Date.now(), note: params.note });
    return { ok: true };
  }
  if (route === 'admin/feedback_list') return samplePage(sampleFeedback.filter(row => (params.status < 0 || row.FB_STATUS === Number(params.status)) && (!search || (row.FB_TITLE + row.FB_CONTENT).includes(search))), params);
  if (route === 'admin/feedback_detail') return copySample(sampleFeedback.find(row => row._id === params.id) || null);
  if (route === 'admin/feedback_reply') {
    const record = sampleFeedback.find(row => row._id === params.id);
    if (!record) throw new Error('示例反馈不存在');
    record.FB_STATUS = params.status; record.FB_VERSION++;
    record.FB_HISTORY.push({ status: params.status, reply: params.reply, at: Date.now() });
    return { ok: true };
  }
  if (route === 'admin/user_list') return samplePage(sampleUsers.filter(row => (params.sortVal === undefined || row.USER_STATUS === Number(params.sortVal)) && (!search || (row.USER_NAME + row.USER_MOBILE).includes(search))), params);
  if (route === 'admin/user_detail') return copySample(sampleUsers.find(row => row._id === params.id) || null);
  if (route === 'admin/user_status') { const user = sampleUsers.find(row => row._id === params.id); if (!user) throw new Error('示例用户不存在'); user.USER_STATUS = params.status; user.USER_CHECK_REASON = params.reason; return { ok: true }; }
  if (route === 'admin/operations_maintain') return { expired: 0, overdue: sampleOverview().overdue, notifications: 0 };
  const reportMatch = /^admin\/(mail|user)_data_(get|export|del)$/.exec(route);
  if (reportMatch) {
    const [, type, action] = reportMatch;
    if (action === 'del') { delete sampleReports[type]; return { ok: true }; }
    if (action === 'export') {
      let records = type === 'mail' ? sampleOrders : sampleUsers;
      if (type === 'mail') records = records.filter(row => (Number(params.status) === 999 || row.MAIL_STATUS === Number(params.status)) &&
        row.MAIL_ADD_TIME >= Date.parse(params.start + 'T00:00:00+08:00') && row.MAIL_ADD_TIME < Date.parse(params.end + 'T00:00:00+08:00') + 86400000);
      if (type === 'user' && params.condition) {
        const condition = JSON.parse(params.condition);
        records = records.filter(row => (condition.status === undefined || row.USER_STATUS === condition.status) && (!condition.search || row.USER_NAME.includes(condition.search)));
      }
      sampleReports[type] = { url: 'sample://' + type + '-report.xlsx', total: records.length, time: '本次预览' };
    }
    return copySample(sampleReports[type] || {});
  }
  throw new Error('此接口不在本地演示范围内');
}
