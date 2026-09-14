'use strict';
// Offline display fixtures only; never used by production pages.
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const now = Date.parse('2026-09-07T10:30:00+08:00');
const config = { enabled: true, paymentMode: 'offline', openHour: 8, closeHour: 22, campuses: ['育才校区', '王城校区', '雁山校区'], smallPrice: 1.5, mediumPrice: 3, largePrice: 5, maxPackages: 20, deliveryMinutes: 120 };
const obj = { campus: '育才校区', title: '快递代取', small: 2, medium: 1, large: 0, price: 6, address1: '一期 · 菜鸟驿站（学生食堂旁）', address2: '五期 3号宿舍楼 201 室，东侧楼梯入口', code: '8-1024、6-0328\n顺丰：1234', poster: '小林同学', tel: '13800000000', desc: '到楼下后请先电话联系，谢谢！', rider: '' };
function mail(status = 0, role = 'poster') {
 return { _id: '68bc410aa6b530bd14ff9831', MAIL_ID: 'KD20260907102816001', MAIL_STATUS: status, MAIL_PAYMENT_MODE: 'offline', MAIL_TOTAL_FEE: 600, MAIL_ADD_TIME: now - 600000,
  MAIL_END_TIME: now + 86400000, MAIL_DUE_TIME: status > 0 && status !== 99 ? now + 7200000 : 0, MAIL_DELIVERED_TIME: [2,9].includes(status) ? now : 0,
  mypost: role === 'poster', myaccept: role === 'rider', MAIL_OBJ: { ...obj }, MAIL_MEDIA: { pickup: [], proof: [], exception: [] },
  acceptUser: status > 0 && status !== 99 ? { USER_NAME: '小陈同学', USER_MOBILE: '13900000000' } : null,
  MAIL_DELIVERY_PROOF: [2,9].includes(status) ? { note: '已放在201室门口，请及时收取。' } : null,
  MAIL_EXCEPTION: status === 3 ? { reason: '取件码错误', note: '驿站提示取件码不匹配，请发布者核对快递短信。' } : null,
  MAIL_HISTORY: [{ id: '1', action: 'publish', actor: 'poster', at: now - 600000 }, ...(status > 0 && status !== 99 ? [{ id: '2', action: 'accept', actor: 'rider', at: now - 300000 }] : [])]
 };
}
function detailFixture(name, status, role, patch = {}) {
 const order = { ...mail(status, role), ...patch };
 if (role === 'public') { // Extra private sentinel values exercise the actual WXML privacy guards.
  Object.assign(order.MAIL_OBJ, { poster: 'PRIVATE_CONTACT_NAME', tel: 'PRIVATE_PHONE', tel2: 'PRIVATE_SECOND_CONTACT', code: 'PRIVATE_CODE', desc: 'PRIVATE_NOTE' });
  order.MAIL_MEDIA = { pickup: ['PRIVATE_PICKUP_IMAGE'], proof: [], exception: [] };
  order.MAIL_DELIVERY_PROOF = { note: 'PRIVATE_PROOF' }; order.MAIL_EXCEPTION = { note: 'PRIVATE_EXCEPTION' };
 }
 if (role !== 'poster') order.MAIL_HISTORY = [{ action: 'publish', note: 'PRIVATE_HISTORY', at: now }];
 const detailUI = UI.detail(order, now);
 return { name, page: role === 'public' ? 'detail/mail_detail' : 'my_detail/mail_my_detail', expected: detailUI.title,
  present: [order.MAIL_OBJ.address1,order.MAIL_OBJ.campus + ' · ' + order.MAIL_OBJ.address2,...([1,4,2,9].includes(status) ? ['已接单','已取件','配送中','待收货','已完成'] : []),...(role === 'public' ? [] : ['订单信息','取件凭证',order.MAIL_ID,...order.MAIL_OBJ.code.split('\n'),...(role === 'poster' ? ['订单动态'] : [])])],
  absent: role === 'public' ? ['PRIVATE_CONTACT_NAME','PRIVATE_PHONE','PRIVATE_SECOND_CONTACT','PRIVATE_CODE','PRIVATE_PICKUP_IMAGE','PRIVATE_NOTE','PRIVATE_PROOF','PRIVATE_EXCEPTION','PRIVATE_HISTORY','取件凭证','订单信息','订单动态',order.MAIL_ID,'接单后可查看详细地址'] : role === 'rider' ? ['PRIVATE_HISTORY','订单动态'] : [],
  data: { isLoad: true, loading: false, id: order._id, mail: { ...order, canAccept: role === 'public' && status === 0, canSeeCode: role !== 'public' }, detailUI } };
}
function scenarios() {
 const publish = { isLoad: true, config, campuses: config.campuses, campus: '育才校区', campusIndex: 0, serviceState: UI.service(config, now), formEnd: '2026-09-10 18:00', formForms: [], fields: [] };
 const fixtures = [
  { name: 'publish-open', page: 'add/mail_add', data: publish, expected: '正常接单', absent: ['暂时停止接单'] },
  { name: 'publish-pending-recovery', page: 'add/mail_add', data: { ...publish, hasPendingSubmission: true }, expected: '核对上次提交' },
  { name: 'publish-paused', page: 'add/mail_add', data: { ...publish, config: { ...config, enabled: false }, serviceState: UI.service({ ...config, enabled: false }, now) }, expected: '管理员已暂停新订单' },
  { name: 'publish-late-hours', page: 'add/mail_add', data: { ...publish, serviceState: UI.service(config, Date.parse('2026-09-07T23:00:00+08:00')) }, expected: '正常接单', absent: ['休息中，营业后可发布'] },
  { name: 'publish-error', page: 'add/mail_add', data: { isLoad: false, configError: true, loadError: '网络暂不可用，请检查连接后重试' }, expected: '重新加载' },
  { name: 'publish-stations', page: 'add/mail_add', data: { ...publish, packagePickupVisible: true, packagePickupNumber: 1, pickupStations: require('../../miniprogram/projects/crun/biz/address_biz.js').PICKUP_STATIONS }, expected: '选择常用快递点', present: ['中通','邮政','京东','其他取件点','确认取件点'], absent: ['从哪里取，送到哪里','取件快递点'] },
  detailFixture('detail-waiting', 0, 'poster'), detailFixture('detail-rider', 1, 'rider'), detailFixture('detail-delivering', 4, 'rider'), detailFixture('detail-poster-delivering', 4, 'poster'), detailFixture('detail-confirm', 2, 'poster'),
  detailFixture('detail-exception', 3, 'poster'), detailFixture('detail-complete', 9, 'poster'), detailFixture('detail-cancelled', 99, 'poster'),
  detailFixture('detail-expired', 0, 'poster', { MAIL_END_TIME: now - 1 }), detailFixture('detail-public', 0, 'public'),
  { name: 'detail-error', page: 'my_detail/mail_my_detail', data: { loading: false, error: true, errorMessage: '订单加载失败，请检查网络后重试', id: 'order' }, expected: '重新加载' },
  detailFixture('detail-long', 2, 'poster', { MAIL_ID: 'KD20260907ABCDEFGH123456789000123456789', MAIL_OBJ: { ...obj, address1: '一期菜鸟驿站（校园西侧学生服务中心一楼最里面的取件处，请从食堂旁边入口进入）', address2: '北区第三号宿舍楼201室东侧楼梯入口（白色门牌），联系电话和地址请勿公开。', code: '8-102412345678901234567890123456789012345678901234567890\n第二个包裹请看截图' }, acceptUser: { USER_NAME: '这是一个比较长的骑手昵称用来检查换行', USER_MOBILE: '13900000000' } })
 ];
 const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="280"><rect width="320" height="280" fill="#eef3fa"/><rect x="84" y="82" width="152" height="132" rx="10" fill="#d5e2f3" stroke="#8faacc" stroke-width="3"/><path d="M148 82h24v50h-24z" fill="#fff"/><text x="160" y="46" text-anchor="middle" font-size="18" fill="#7f99ba">OFFLINE UI FIXTURE</text></svg>').toString('base64');
 const media = detailFixture('detail-media', 2, 'poster', { MAIL_MEDIA: { pickup: [image,image], proof: [image], exception: [] } }); fixtures.push(media);
 const attached = detailFixture('detail-attached-sheet', 4, 'rider'); attached.data.panel = 'deliver'; attached.data.note = '已放到门口，请及时查收。'; attached.data.images = [image,image]; fixtures.push(attached);
 const sheet = detailFixture('detail-delivery-sheet', 4, 'rider'); sheet.data.panel = 'deliver'; fixtures.push(sheet);
 const exception = detailFixture('detail-exception-sheet', 1, 'rider'); exception.data.panel = 'exception'; fixtures.push(exception);
 const proofId = 'cloud://fixture/private-evidence/rider/proof.png';
 const proof = { note: '已放到正确的201室门口，请及时收取。', images: [proofId], at: now, updatedAt: now + 60000 };
 for (const [role, status] of [['rider', 2], ['rider', 3], ['rider', 9], ['rider', 99], ['poster', 2], ['public', 2]]) {
  for (const page of ['detail/mail_detail', 'my_detail/mail_my_detail']) {
   const updated = detailFixture('detail-proof-' + role + '-' + status + '-' + page, status, role, { MAIL_DELIVERY_PROOF: proof, MAIL_MEDIA: { pickup: [], proof: [image], exception: [] } });
   updated.page = page;
   (role === 'rider' && status === 2 ? updated.present : updated.absent).push('bindUpdateProofTap');
   if (role !== 'public') updated.present.push('更新时间');
   fixtures.push(updated);
  }
 }
 for (const available of [true, false]) {
  const updateSheet = detailFixture('detail-proof-update-sheet-' + available, 2, 'rider', { MAIL_DELIVERY_PROOF: proof });
  Object.assign(updateSheet.data, { panel: 'update_proof', note: proof.note, images: [proofId], imagePreviews: { [proofId]: available ? image : '' } });
  updateSheet.present.push('更新送达凭证', '保存更新', '至少保留1张照片');
  if (!available) updateSheet.present.push('照片暂不可用');
  fixtures.push(updateSheet);
 }
 for (const [role, status] of [['public',0],['public',1],['rider',1],['rider',9],['poster',0],['poster',1]]) {
  for (const page of ['detail/mail_detail','my_detail/mail_my_detail']) {
   const fixture = detailFixture('detail-privacy-' + role + '-' + status + '-' + page, status, role);
   fixture.page = page; fixtures.push(fixture);
  }
 }
 return fixtures;
}
module.exports = { scenarios };
