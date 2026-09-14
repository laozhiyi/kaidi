'use strict';
const { harness } = require('./admin-console-harness.cjs');

// Local sample states only. Production pages do not import this file.
function scenarios() {
  const UI = harness('index/home/admin_home.js').UI;
  const overview = UI.summary({ total: 1284, waiting: 28, accepted: 18, picked: 12, delivered: 9, exceptions: 3, completed: 1200, cancelled: 14, users: 306, pendingUsers: 4, todayOrders: 42, todayCompleted: 31, complaints: 2, overdue: 5, failedNotifications: 2 });
  const config = { enabled: true, campuses: ['育才校区', '王城校区', '雁山校区'], smallPrice: 1.5, mediumPrice: 3, largePrice: 5, maxPackages: 20, maxActiveOrders: 3, maxOpenOrders: 10, deliveryMinutes: 120, urgentMinutes: 60, openHour: 8, closeHour: 22, urgentEnabled: false, registrationReview: true, offlineNotice: '请与接单人核对件数和费用后线下结算。' };
  const user = UI.user({ _id: 'sample-user-document-id', USER_MINI_OPENID: 'sample-openid-long-user-identifier', USER_NAME: '示例用户', USER_MOBILE: '13800000000', USER_STATUS: 0, USER_ADD_TIME: 1789351200000, USER_FORMS: [{ title: '校区', val: '育才校区' }, { title: '宿舍地址', val: '南苑学生宿舍第十二栋 301 室' }] });
  const service = { _id: 'service-one', CS_CAMPUS: '育才校区', CS_NAME: '示例客服', CS_STATUS: 1, CS_MOBILE: '13800000000', CS_WORK_TIME: '周一至周日 08:00–22:00，节假日安排以公告为准', CS_WECHAT: 'sample_campus_service_contact', CS_QQ: '1000000001', CS_ORDER: 0 };
  const manager = { _id: 'manager-one', ADMIN_NAME: 'sample_campus_administrator', ADMIN_DESC: '校区运营管理员', ADMIN_TYPE: 0, ADMIN_STATUS: 1, ADMIN_PHONE: '13800000000', ADMIN_LOGIN_CNT: 1, ADMIN_LOGIN_TIME: '2026-09-14 10:20' };
  const news = { _id: 'news-one', NEWS_TITLE: '关于开学季校区快递代取服务时间调整的通知', NEWS_DESC: '为方便同学们领取开学包裹，校区服务时间和取件安排如下，请及时查看。', NEWS_CATE_NAME: '校区公告', NEWS_STATUS: 1, NEWS_ORDER: 0, NEWS_VOUCH: 1, NEWS_ADD_TIME: '2026-09-14 10:20', NEWS_PIC: [] };
  const content = [{ type: 'text', val: '欢迎使用 GXNU 随手取。我们为同学们提供校区快递代取与配送服务。\n如需帮助，请联系所在校区的客服。' }];
  const list = row => ({ list: [row], total: 1, page: 1, hasMore: false });
  const managerForm = { isLoad: true, formName: 'sample_admin', formDesc: '校区管理员', formPhone: '13800000000' };
  const campusForm = { isLoad: true, formCampus: '育才校区', formName: '示例客服', formMobile: '13800000000', formWechat: 'sample_campus_contact', formQQ: '1000000001', formWorkTime: '周一至周日 08:00–22:00', formOrder: 0 };
  const newsForm = { isLoad: true, fields: [], cateIdOptions: [{ label: '校区公告', value: '1' }], formTitle: news.NEWS_TITLE, formOrder: 0, formDesc: news.NEWS_DESC, formContent: content, contentDesc: '1 段文字', imgList: [], formForms: [] };
  const cases = [
    ['home', '运营工作台', 'index/home/admin_home', { overview, config, dateText: '9 月 14 日' }, '常用功能'],
    ['settings', '管理中心', 'settings/index/admin_settings', {}, '数据统计'],
    ['users', '用户管理', 'user/list/admin_user_list', list(user), '用户管理'],
    ['user', '用户详情与审核', 'user/detail/admin_user_detail', { user, reason: '已核实校区与联系方式' }, '审核通过'],
    ['userError', '用户详情读取失败', 'user/detail/admin_user_detail', { error: '网络连接失败，请稍后重试' }, '重新读取'],
    ['userMissing', '用户不存在', 'user/detail/admin_user_detail', { notFound: true }, '用户不存在'],
    ['analytics', '数据统计', 'analytics/admin_analytics', { overview }, '订单状态分布'],
    ['analyticsEmpty', '数据统计 · 暂无订单', 'analytics/admin_analytics', { overview: UI.summary({}) }, '暂无订单'],
    ['chats', '客服会话', 'campus_service/chat_list/admin_campus_chat_list', list({ _id: 'chat-one', CSM_SESSION_ID: 'session-one', CS_CAMPUS: service.CS_CAMPUS, CS_NAME: service.CS_NAME, CSM_USER_ID: user.USER_MINI_OPENID, unread: 12, lastContent: '请问今天下午可以帮忙代取开学快递吗？我有三个包裹，想确认一下服务时间。', lastTime: '2026-09-14 10:20' }), '查看对话'],
    ['chat', '客服会话详情', 'campus_service/chat_detail/admin_campus_chat_detail', { service, userId: user.USER_MINI_OPENID, isLoad: true, ownSender: 'admin', content: '可以的，请提供取件信息。', messages: [{ CSM_ID: 'm1', CSM_SENDER: 'user', CSM_CONTENT: '请问今天下午可以代取快递吗？有三个包裹，想确认一下服务时间。', CSM_ADD_TIME: '10:20' }, { CSM_ID: 'm2', CSM_SENDER: 'admin', CSM_CONTENT: '同学你好，今天服务时间为 08:00–22:00。', CSM_ADD_TIME: '10:21' }] }, '查看资料'],
    ['chatStopped', '停用客服的会话', 'campus_service/chat_detail/admin_campus_chat_detail', { service: { ...service, CS_STATUS: 0 }, isLoad: true, messages: [] }, '仅可查看历史消息'],
    ['services', '校区客服配置', 'campus_service/list/admin_campus_service_list', list(service), '编辑配置'],
    ['serviceAdd', '添加校区客服', 'campus_service/add/admin_campus_service_add', campusForm, '负责人姓名'],
    ['serviceEdit', '编辑校区客服', 'campus_service/edit/admin_campus_service_edit', { ...campusForm, id: service._id }, '保存修改'],
    ['about', '关于与联系', 'setup/about_list/admin_setup_about_list', { list: [{ key: 'SETUP_CONTENT_ABOUT', title: '关于我们', icon: 'info', description: '小程序介绍、服务范围与使用说明' }, { key: 'SETUP_CONTENT_CONTACT', title: '联系我们', icon: 'service', description: '联系渠道、咨询方式与服务说明' }] }, '关于我们'],
    ['aboutEdit', '编辑关于与联系', 'setup/about/admin_setup_about', { isLoad: true, title: '联系我们', key: 'SETUP_CONTENT_CONTACT', formContent: content }, '保存修改'],
    ['qr', '小程序码', 'setup/qr/admin_setup_qr', {}, '生成小程序码'],
    ['qrError', '小程序码图片异常', 'setup/qr/admin_setup_qr', { imageError: true, qrUrl: 'sample-image', error: '小程序码图片已失效，请重新生成' }, '重新生成'],
    ['monitor', '系统维护', 'monitor/admin_monitor', { overview, result: { expired: 3, overdue: 5, notifications: 2 }, ranAt: '10:30' }, '本次执行结果'],
    ['monitorReadOnly', '系统维护 · 只读', 'monitor/admin_monitor', { overview, isSuperAdmin: false }, '执行维护需要超级管理员权限'],
    ['managers', '管理员账号', 'mgr/list/admin_mgr_list', list(manager), '编辑资料'],
    ['managerAdd', '添加管理员', 'mgr/add/admin_mgr_add', managerForm, '登录账号'],
    ['managerEdit', '编辑管理员', 'mgr/edit/admin_mgr_edit', managerForm, '保存修改'],
    ['managerMissing', '管理员不存在', 'mgr/edit/admin_mgr_edit', { notFound: true, isLoad: false }, '管理员账号不存在'],
    ['logs', '操作日志', 'mgr/log/admin_log_list', list({ _id: 'log-one', LOG_TYPE_DESC: '用户', LOG_CONTENT: '审核通过用户资料，并核实校区联系方式与宿舍楼栋信息。操作记录保留，便于后续核查。', LOG_ADMIN_NAME: manager.ADMIN_NAME, LOG_ADMIN_DESC: manager.ADMIN_DESC, LOG_ADD_TIME: '2026-09-14 10:20:00', LOG_ADD_IP: '2001:db8:1234:5678:9012:3456:7890:1234' }), '清空日志'],
    ['password', '修改我的密码', 'mgr/pwd/admin_mgr_pwd', {}, '新密码'],
    ['news', '公告管理', 'news/list/admin_news_list', list(news), '状态管理'],
    ['newsEmpty', '公告管理 · 空列表', 'news/list/admin_news_list', {}, '暂无符合条件的公告'],
    ['newsError', '公告管理 · 网络错误', 'news/list/admin_news_list', { error: '读取失败，请检查网络后重试' }, '重新加载'],
    ['newsAdd', '发布公告', 'news/add/admin_news_add', newsForm, '发布公告'],
    ['newsEdit', '编辑公告', 'news/edit/admin_news_edit', { ...newsForm, id: news._id }, '保存修改'],
    ['content', '公告正文编辑', 'content/admin_content', { formContent: content }, '保存'],
    ['login', '管理员登录', 'index/login/admin_login', { name: '', pwd: '' }, '登录'],
    ['pricing', '价格与数字输入框', 'settings/pricing/admin_pricing_settings', { config }, '保存设置'],
    ['serviceSettings', '服务范围与营业时间', 'settings/service/admin_service_settings', { config }, '服务范围'],
    ['rules', '接单与履约规则', 'settings/rules/admin_rules_settings', { config }, '保存设置']
  ];
  return cases.map(([id, title, page, data, expected]) => ({ id, title, page, data, expected }));
}

function pageState(fixture) {
  return { ...harness(fixture.page + '.js').page.data, isAdmin: true, isSuperAdmin: true, admin: { name: '运营管理员', type: 1 }, ...fixture.data };
}
module.exports = { scenarios, pageState };
