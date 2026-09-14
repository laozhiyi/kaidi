'use strict';
const path = require('node:path');
const UI = require('../miniprogram/projects/crun/biz/mail_ui_biz.js');
const { runMiniProgram } = require('../scripts/test-support/miniprogram-module.cjs');
const statuses = { 0: '待接单', 1: '已接单', 4: '已取件', 2: '待收货', 9: '已完成' };
function order(status, role = 'rider') {
 return { _id: 'delivery-preview', MAIL_ID: 'KD20260915001', MAIL_STATUS: status, status: statuses[status], MAIL_PAYMENT_MODE: 'offline', MAIL_ADD_TIME: '2026-09-15 10:20', MAIL_END_TIME: Date.now() + 86400000, MAIL_DUE_TIME: Date.now() + 7200000,
  mypost: role === 'poster', myaccept: role === 'rider', MAIL_FAV_CNT: 2, MAIL_MEDIA: {},
  MAIL_HISTORY: [{ action: 'publish', at: Date.now() - 1800000, actor: 'poster' }, { action: 'accept', at: Date.now() - 900000, actor: 'rider' }, ...(status !== 1 ? [{ action: 'pickup', at: Date.now() - 300000, actor: 'rider' }] : [])],
  MAIL_OBJ: { title: '快递代取', campus: '育才校区', poster: '林同学', tel: '13800000000', price: 9.5, small: 1, medium: 1, large: 1, num: 3, address1: '二期 · 中通；五期 · 邮政', address2: '五期 第18号宿舍楼207室（从东侧楼梯上二楼，门口蓝色鞋架旁）', leftTimeLabel: '2小时', packages: [{ type: 'small', pickupPoint: '二期 · 中通', code: 'A-314', note: '' }, { type: 'medium', pickupPoint: '五期 · 邮政', code: 'B-628', note: '到楼下先联系' }, { type: 'large', pickupPoint: '二期 · 中通', code: 'C-006', note: '' }] },
  ...(status === 2 || status === 9 ? { MAIL_DELIVERY_PROOF: { note: '已放在207室门口蓝色鞋架旁。' } } : {}) };
}
function scenarios() {
 const cases = [
  ...[[0, 0, 'public'], [1, 1, 'rider'], [1, 4, 'rider'], [1, 2, 'rider'], [2, 4, 'poster'], [3, 9, 'rider']].map(([tab, status, role]) => ({
   id: 'card-' + tab + '-' + status, title: ['可接单', '我的接单', '我的发布', '已完成'][tab] + ' · ' + statuses[status], base: 'projects/crun/pages/order/index/order_index', tab, mail: order(status, role), expected: '育才校区 · 五期' })),
  ...[[1, 'rider'], [4, 'rider'], [4, 'poster'], [2, 'rider'], [2, 'poster'], [9, 'rider']].map(([status, role]) => ({
   id: 'detail-' + status + '-' + role, title: '订单详情 · ' + statuses[status] + (role === 'poster' ? ' · 发布者' : ' · 接单人'), base: 'projects/crun/pages/mail/my_detail/mail_my_detail', mail: order(status, role), expected: '育才校区 · 五期' })),
  { id: 'public-detail', title: '可接单详情 · 完整地址', base: 'projects/crun/pages/mail/detail/mail_detail', mail: order(0, 'public'), expected: '育才校区 · 五期' },
  { id: 'delivery-form', title: '订单详情 · 提交送达说明与照片', base: 'projects/crun/pages/mail/my_detail/mail_my_detail', mail: order(4, 'rider'), panel: 'deliver', expected: '送达照片（至少1张）' },
 ];
 return cases;
}
function pageState(fixture) {
 let page;
 runMiniProgram(path.join(__dirname, '../miniprogram', fixture.base + '.js'), { Page: value => { page = value; }, require: name => name.includes('mail_ui_biz') ? UI : {} });
 const mail = structuredClone(fixture.mail);
 return { ...page.data, isLoad: true, loading: false, ...(fixture.tab !== undefined
  ? { tabIndex: fixture.tab, dataList: { list: [page._decorateOrder(mail)], total: 1 } }
  : { mail, id: mail._id, detailUI: UI.detail(mail), panel: fixture.panel || '' }) };
}
module.exports = { scenarios, pageState, previewTitle: '订单进度与完整地址', previewSummary: '订单卡片、详情和送达表单均无横向溢出。' };
