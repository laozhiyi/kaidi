'use strict';
const Base = require('../base_project_service.js');
const Mail = require('../../model/mail_model.js');
const User = require('../../model/user_model.js');
const exportsUtil = require('../../../../framework/utils/export_util.js');
const rules = require('../order_rules.js');
const crypto = require('crypto');
const LIMIT = 5000;
const safe = value => { const text = String(value == null ? '' : value); return /^[\s]*[=+@-]/.test(text) ? "'" + text : text; };
const dateText = value => Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value) + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') : '';
class AdminReportService extends Base {
 key(type, adminId) {
  if (!adminId) this.AppError('管理员身份已失效');
  return 'EXPORT_' + type.toUpperCase() + '_' + crypto.createHash('sha256').update(this.getProjectId() + ':' + adminId).digest('hex').slice(0, 24);
 }
 day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) this.AppError('请选择有效日期');
  const timestamp = Date.parse(value + 'T00:00:00+08:00');
  if (!Number.isFinite(timestamp) || new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) !== value) this.AppError('日期无效');
  return timestamp;
 }
 async rows(model, where, orderField) {
  const total = await model.count(where);
  if (total > LIMIT) this.AppError('结果超过5000条，请缩小筛选范围后导出');
  // getAll silently caps reads at 1,000. Read bounded pages and probe one more
  // page at the limit so records added after count() cannot be silently cut off.
  const rows = [], size = 1000;
  for (let page = 1; page <= LIMIT / size + 1; page++) {
   const result = await model.getList(where, '*', { [orderField]: 'desc', _id: 'desc' }, page, size, false, 0);
   if (!result || !Array.isArray(result.list)) this.AppError('报表数据读取失败，请重试');
   rows.push(...result.list);
   if (rows.length > LIMIT) this.AppError('结果超过5000条，请缩小筛选范围后导出');
   if (result.list.length < size) break;
  }
  return rows;
 }
 async mail({ start, end, status }, adminId) {
  const key = this.key('mail', adminId), from = this.day(start), until = this.day(end) + 86400000 - 1;
  if (from > until) this.AppError('开始日期不能晚于结束日期');
  if (![999, 0, 1, 4, 2, 3, 9, 99].includes(status)) this.AppError('订单状态无效');
  const where = { _pid: this.getProjectId(), MAIL_ADD_TIME: ['between', from, until] };
  if (status !== 999) where.MAIL_STATUS = status;
  const rows = await this.rows(Mail, where, 'MAIL_ADD_TIME');
  const data = [['订单编号', '状态', '校区', '任务名称', '包裹数', '订单费用（元）', '结算方式', '发布时间', '接单时间', '取件时间', '送达时间', '完成时间']];
  for (const row of rows) {
   const obj = row.MAIL_OBJ || {};
   data.push([safe(row.MAIL_ID || row._id), rules.LABELS[row.MAIL_STATUS] || '状态未知', safe(obj.campus), safe(obj.title), Number(obj.num || 0), Number.isFinite(Number(obj.price)) ? Number(obj.price) : '', row.MAIL_PAYMENT_MODE === 'offline' ? '线下结算' : '历史支付订单', dateText(row.MAIL_ADD_TIME), dateText(row.MAIL_ACCEPT_TIME), dateText(row.MAIL_PICKUP_TIME), dateText(row.MAIL_DELIVERED_TIME), dateText(row.MAIL_OVER_TIME)]);
  }
  return exportsUtil.exportDataExcel(key, '订单报表', rows.length, data);
 }
 async users(condition, adminId) {
  const key = this.key('user', adminId);
  let input = {};
  if (condition) {
   try { input = JSON.parse(decodeURIComponent(condition)); } catch (_) { this.AppError('用户筛选条件无效，请返回列表重新筛选'); }
  }
  const where = { and: { _pid: this.getProjectId() } };
  if (input.and && input.and.USER_STATUS !== undefined) {
   if (![0, 1, 8, 9].includes(input.and.USER_STATUS)) this.AppError('用户状态无效');
   where.and.USER_STATUS = input.and.USER_STATUS;
  }
  if (input.or) {
   if (!Array.isArray(input.or) || input.or.length > 3) this.AppError('用户筛选条件无效');
   where.or = input.or.map(part => {
    const keys = Object.keys(part || {}), field = keys[0], value = part && part[field];
    if (keys.length !== 1 || !['USER_NAME', 'USER_MOBILE', 'USER_MEMO'].includes(field) || !Array.isArray(value) || value[0] !== 'like' || typeof value[1] !== 'string' || value[1].length > 100) this.AppError('用户筛选条件无效');
    return { [field]: ['like', value[1]] };
   });
  }
  const rows = await this.rows(User, where, 'USER_ADD_TIME');
  const data = [['姓名', '手机号码', '账号状态', '注册时间', '最近登录', '最近处理说明']];
  for (const row of rows) data.push([safe(row.USER_NAME), safe(row.USER_MOBILE), ({ 0: '待审核', 1: '正常', 8: '审核未过', 9: '已停用' })[row.USER_STATUS] || '状态未知', dateText(row.USER_ADD_TIME), dateText(row.USER_LOGIN_TIME), safe(row.USER_CHECK_REASON)]);
  return exportsUtil.exportDataExcel(key, '用户报表', rows.length, data);
 }
}
module.exports = AdminReportService;
