'use strict';
const path = require('node:path');
const { runMiniProgram } = require('./miniprogram-module.cjs');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const mini = path.resolve(__dirname, '../../miniprogram');
const labels = { 0: '待接单', 1: '已接单', 2: '已送达', 3: '异常处理中', 4: '配送中', 9: '已完成', 99: '已取消' };
function make(status, page, role = 'poster', expired = false) {
 const mail = { _id: 'receipt-order', MAIL_ID: 'KD202609142312', MAIL_STATUS: status, MAIL_PAYMENT_MODE: 'offline',
  MAIL_ADD_TIME: '2026-09-14 23:12', MAIL_END_TIME: Date.now() + (expired ? -1 : 86400000),
  mypost: role === 'poster', myaccept: role === 'rider', status: labels[status], MAIL_MEDIA: {}, MAIL_HISTORY: [],
  MAIL_OBJ: { title: '快递代取', price: 1.5, small: 1, address1: '二期 · 韵达', address2: '四期 64', campus: '育才校区' },
  acceptUser: status > 0 ? { USER_NAME: '接单同学', USER_MOBILE: '13900000000' } : null };
 const isList = page === 'order/index/order_index';
 return { id: (isList ? 'list' : 'detail') + '-' + role + '-' + status + (expired ? '-expired' : ''),
  title: (isList ? '我的发布' : '订单详情') + ' · ' + (expired ? '已过期' : labels[status]) + (role !== 'poster' ? ' · ' + role : ''),
  base: 'projects/crun/pages/' + page, mail, isList, receiptExpected: role === 'poster' && ![9, 99].includes(status),
  editExpected: !isList && role === 'poster' && status === 0 && !expired,
  expected: isList ? '我的发布' : UI.detail(mail).title };
}
function scenarios() {
 const pages = ['order/index/order_index', 'mail/my_detail/mail_my_detail'];
 return [
  ...[0, 1, 4, 2, 3, 9, 99].flatMap(status => pages.map(page => make(status, page))),
  ...pages.map(page => make(0, page, 'poster', true)),
  make(2, pages[1], 'rider'), make(0, pages[1], 'public')
 ];
}
function pageState(fixture) {
 let page;
 runMiniProgram(path.join(mini, fixture.base + '.js'), { Page: value => { page = value; }, require: name => name.includes('mail_ui_biz') ? UI : {} });
 const mail = structuredClone(fixture.mail);
 return { ...structuredClone(page.data), ...(fixture.isList
  ? { isLoad: true, tabIndex: 2, dataList: { list: [page._decorateOrder(mail)], total: 1 } }
  : { loading: false, mail, id: mail._id, detailUI: UI.detail(mail) }) };
}
module.exports = { scenarios, pageState, previewTitle: '确认收货入口检查', previewSummary: '发布人各状态的收货入口、说明及窄屏布局检查完成。' };
