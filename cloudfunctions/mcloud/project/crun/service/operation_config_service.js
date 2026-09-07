'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const DEFAULTS = Object.freeze({ enabled: true, paymentMode: 'offline', smallPrice: 1.5, mediumPrice: 3, largePrice: 5, maxPackages: 20, maxActiveOrders: 3, maxOpenOrders: 10, deliveryMinutes: 120, urgentMinutes: 60, urgentEnabled: false, openHour: 8, closeHour: 22, registrationReview: false, campuses: ['育才校区', '王城校区', '雁山校区'], offlineNotice: '费用由双方线下协商结算，平台不代收、不担保；请勿提前向陌生人转账。' });
class OperationConfigService extends Base {
 async getConfig(tx = store.database()) {
  const row = await store.get(tx, 'operation_config', store.key(this.getProjectId(), 'config'));
  // Only an absent document uses the default opening policy. Read failures propagate;
  // saved pauses and malformed legacy settings must never be silently re-enabled.
  return { ...DEFAULTS, ...(row && row.value || {}),
   enabled: row ? !!(row.value && row.value.enabled === true) : DEFAULTS.enabled,
   configured: !!row, paymentMode: 'offline' };
 }
 async saveConfig(value, adminId) {
  const next = {}; if (!value || typeof value !== 'object') this.AppError('配置不能为空');
  for (const name of ['enabled','urgentEnabled','registrationReview']) { if (typeof value[name] !== 'boolean') this.AppError('配置开关无效'); next[name] = value[name]; }
  const ranges = { smallPrice:[0,100], mediumPrice:[0,100], largePrice:[0,100], maxPackages:[1,100], maxActiveOrders:[1,20], maxOpenOrders:[1,50], deliveryMinutes:[10,1440], urgentMinutes:[10,1440], openHour:[0,23], closeHour:[1,24] };
  for (const [name, range] of Object.entries(ranges)) { const n = value[name]; if (typeof n !== 'number' || !Number.isFinite(n) || n < range[0] || n > range[1] || (!name.endsWith('Price') && !Number.isInteger(n)) || name.endsWith('Price') && Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) this.AppError('配置数值无效：' + name); next[name] = n; }
  if (next.openHour >= next.closeHour || next.urgentMinutes > next.deliveryMinutes) this.AppError('营业时间或加急时效无效');
  if (!Array.isArray(value.campuses) || !value.campuses.length || value.campuses.length > 20 || value.campuses.some(x => typeof x !== 'string' || !x.trim() || x.length > 30)) this.AppError('请设置1至20个有效校区');
  next.campuses = [...new Set(value.campuses.map(x => x.trim()))]; next.paymentMode = 'offline';
  next.offlineNotice = String(value.offlineNotice || DEFAULTS.offlineNotice).trim(); if (next.offlineNotice.length > 300) this.AppError('结算说明过长');
  const id = store.key(this.getProjectId(), 'config'); await store.transaction(async tx => { const admin = await store.get(tx,'admin',adminId); if (!admin || admin._pid !== this.getProjectId() || admin.ADMIN_STATUS !== 1 || admin.ADMIN_TYPE !== 1) this.AppError('超级管理员权限已失效'); const old = await store.get(tx,'operation_config',id); await store.set(tx,'operation_config',id,{ _pid:this.getProjectId(), value:next, updatedAt:Date.now(), adminId }); await store.set(tx,'operation_audit',store.key(id,Date.now(),adminId),{ _pid:this.getProjectId(), adminId, action:'config', before:old && old.value || {}, after:next, createdAt:Date.now() }); }); return next;
 }
}
OperationConfigService.DEFAULTS = DEFAULTS;
module.exports = OperationConfigService;
