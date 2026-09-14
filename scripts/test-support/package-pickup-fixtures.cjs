'use strict';
const path = require('node:path');
const { runMiniProgram } = require('./miniprogram-module.cjs');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const Address = require('../../miniprogram/projects/crun/biz/address_biz.js');
const mini = path.resolve(__dirname, '../../miniprogram');
const config = { enabled: true, paymentMode: 'offline', openHour: 8, closeHour: 22, campuses: ['育才校区'], smallPrice: 1.5, mediumPrice: 3, largePrice: 5, maxPackages: 20 };
const parcels = [
 { id: 'parcel-1', type: 'small', label: '小件', price: '1.50', referencePrice: '1.50', pickupPoint: '二期 · 中通', code: 'A-314', note: '', images: [] },
 { id: 'parcel-2', type: 'small', label: '小件', price: '2.50', referencePrice: '1.50', pickupPoint: '五期 · 邮政（学生活动中心后门取件处）', code: 'B-628', note: '到楼下后请联系', images: [] }
];
const publish = { isLoad: true, config, campuses: config.campuses, campus: '育才校区', campusIndex: 0, serviceState: UI.service(config),
 formEnd: '2026-09-15 18:00', totalCount: 2, totalFee: '4.00', packageTypes: [{ mark: 'small', label: '小件', price: '1.50', count: 2 }, { mark: 'medium', label: '中件', price: '3.00', count: 0 }, { mark: 'large', label: '大件', price: '5.00', count: 0 }],
 packageItems: parcels, mailValues: { address2: '一期1号宿舍楼201室', poster: '小林', tel: '13800000000', tel2: '' }, pickupStations: Address.PICKUP_STATIONS, fields: [], formForms: [] };
const definitions = new Map();
function pageState(fixture) {
 if (!definitions.has(fixture.base)) {
  let definition;
  runMiniProgram(path.join(mini, fixture.base + '.js'), { Page: value => { definition = value; }, Component: value => { definition = value; }, require: () => ({}) });
  definitions.set(fixture.base, definition.data || {});
 }
 return { ...definitions.get(fixture.base), ...fixture.data };
}
function componentState(base, attrs, defaults) {
 return base.endsWith('/mail_add_embedded') ? { ...defaults, ...publish, embedded: true } : defaults;
}
function scenarios() {
 const absent = ['从哪里取，送到哪里', '取件快递点'];
 const present = ['自定义价格', '取件点', '二期 · 中通', '五期 · 邮政', 'A-314', 'B-628', '送到哪里'];
 const accepted = { _id: 'parcel-pickup-order', MAIL_ID: 'PICKUP-ORDER', myaccept: true, mypost: false, MAIL_STATUS: 1, MAIL_PAYMENT_MODE: 'offline',
  MAIL_OBJ: { small: 2, price: 4, packages: parcels, address1: '二期 · 中通；五期 · 邮政', address2: '一期1号宿舍楼201室', poster: '小林', tel: '13800000000' }, MAIL_MEDIA: { pickup: [], packages: [[], []] } };
 return [
  { id: 'pickup-home', title: '首页 · 公告与快递代取', base: 'projects/crun/pages/default/index/default_index', data: { isLoad: true, cnt: 6, noticeLoaded: true, featuredNews: { title: '校园快递代取服务公告', content: '填写包裹对应的取件点，方便骑手按件取送', read: true } }, expected: '快递代取' },
  { id: 'pickup-form', title: '首页表单 · 每件包裹分别选择取件点', base: 'projects/crun/pages/mail/add/mail_add_embedded', data: { ...publish, embedded: true }, expected: '每件包裹信息', present, absent },
  { id: 'pickup-page', title: '独立发布页 · 每件包裹分别选择取件点', base: 'projects/crun/pages/mail/add/mail_add', data: publish, expected: '每件包裹信息', present, absent },
  { id: 'pickup-empty', title: '首页表单 · 尚未选择取件点', base: 'projects/crun/pages/mail/add/mail_add_embedded', data: { ...publish, embedded: true, packageItems: parcels.map(item => ({ ...item, pickupPoint: '' })) }, expected: '选择快递点', absent },
  { id: 'pickup-sheet', title: '第2件包裹 · 常用快递点', base: 'projects/crun/pages/mail/add/mail_add_embedded', data: { ...publish, embedded: true, packagePickupVisible: true, packagePickupId: 'parcel-2', packagePickupNumber: 2, packagePickupDraft: '五期 · 邮政' }, expected: '选择常用快递点', present: ['中通', '圆通', '申通', '韵达', '顺丰', '邮政', '极兔', '京东', '其他取件点', '确认取件点'], absent },
  { id: 'pickup-detail', title: '接单详情 · 取件点与凭证逐件对应', base: 'projects/crun/pages/mail/my_detail/mail_my_detail', data: { mail: accepted, detailUI: UI.detail(accepted), loading: false }, expected: '取件凭证', present: ['第1件 · 小件', '第2件 · 小件', '二期 · 中通', '五期 · 邮政', 'A-314', 'B-628'], absent: ['订单动态'] }
 ];
}
module.exports = { scenarios, pageState, componentState, previewTitle: '首页包裹取件点 · 布局检查', previewSummary: '无页面横向溢出。' };
