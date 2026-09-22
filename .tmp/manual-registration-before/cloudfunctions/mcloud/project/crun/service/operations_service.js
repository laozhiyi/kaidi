'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const Config = require('./operation_config_service.js');
const rules = require('./order_rules.js');
class OperationsService extends Base {
 async feed(){const rows=await store.database().collection(store.collection('order_feed')).where({_pid:this.getProjectId()}).field({_id:true,revision:true}).limit(64).get();return {docs:rows.data};}
 async list(name, where = {}, page = 1, orderField = 'createdAt', size = 20, options = {}) {
  page = Number(page);
  size = Number(size);
  if (!Number.isInteger(page) || page < 1 || page > 500 || !Number.isInteger(size) || size < 1 || size > 50) this.AppError('分页参数无效');
  const db = store.database();
  const conditions = [{ ...where, _pid: this.getProjectId() }, ...(options.conditions || [])];
  if (options.search) {
   const text = rules.text(options.search, '搜索关键词', 50, true).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
   const expression = db.RegExp({ regexp: text, options: 'i' });
   conditions.push(db.command.or(options.searchFields.map(field => ({ [field]: expression }))));
  }
  const filter = conditions.length === 1 ? conditions[0] : db.command.and(conditions);
  const query = () => db.collection(store.collection(name)).where(filter);
  const direction = options.direction === 'asc' ? 'asc' : 'desc';
  let sorted = query().orderBy(options.sortField || orderField, direction);
  if (options.sortField && options.sortField !== orderField) sorted = sorted.orderBy(orderField, 'desc');
  const [result, count] = await Promise.all([
   sorted.orderBy('_id', direction).skip((page - 1) * size).limit(size).get(),
   query().count()
  ]);
  const total = count.total;
  return { list: result.data, page, size, total, count: Math.ceil(total / size), hasMore: page * size < total };
 }
 async config(userId) { return {...await new Config().getConfig(),templateId:process.env.ORDER_SUBSCRIBE_TEMPLATE_ID || '',uploadPrefix:'private/'+userId.split('^^^').pop()+'/'}; }
 async notifications(userId,page,options={}) {return new (require('./notification_service.js'))().list(userId,{...options,page});}
 async notificationSummary(userId) {return new (require('./notification_service.js'))().summary(userId);}
 async markRead(userId,id,kind) {return new (require('./notification_service.js'))().markRead(userId,id,kind);}
 async markAllRead(userId) {return new (require('./notification_service.js'))().markAllRead(userId);}
 async subscribe(userId,enabled) {await new Mail()._user(userId);if(typeof enabled!=='boolean')this.AppError('订阅设置无效');await store.set(store.database(),'subscription',store.scopeKey(this.getProjectId(),userId),{_pid:this.getProjectId(),userId,enabled,updatedAt:Date.now()});return {ok:true};}
 async orders(page, status, options = {}) {
  const db = store.database(), where = { MAIL_ADMIN_DELETED: db.command.neq(true) };
  if (status !== undefined && status !== -1) {
   if (![0, 1, 2, 3, 4, 9, 99].includes(status)) this.AppError('状态无效');
   where.MAIL_STATUS = status;
  }
  if (options.campus) where['MAIL_OBJ.campus'] = rules.text(options.campus, '校区', 30, true);
  const sorts = { recent: ['MAIL_ADD_TIME', 'desc'], oldest: ['MAIL_ADD_TIME', 'asc'], price_high: ['MAIL_OBJ.price', 'desc'], price_low: ['MAIL_OBJ.price', 'asc'] };
  if (options.sort && !Object.prototype.hasOwnProperty.call(sorts, options.sort)) this.AppError('排序方式无效');
  if (options.overdue !== undefined && typeof options.overdue !== 'boolean') this.AppError('超时筛选无效');
  const [sortField, direction] = sorts[options.sort || 'recent'];
  const conditions = options.overdue ? [{ MAIL_STATUS: db.command.in(rules.ACTIVE) }, { MAIL_DUE_TIME: db.command.gt(0) }, { MAIL_DUE_TIME: db.command.lt(Date.now()) }] : [];
  const result = await this.list('mail', where, page, 'MAIL_ADD_TIME', 20, { sortField, direction, conditions, search: options.search, searchFields: ['MAIL_ID', 'MAIL_OBJ.title'] });
  result.list = result.list.map(row => rules.project(row, ''));
  return result;
 }
 async orderDetail(id) {
  const mail = await store.get(store.database(), 'mail', id);
  if (!mail || mail._pid !== this.getProjectId() || mail.MAIL_ADMIN_DELETED === true) return null;
  const User = require('../model/user_model.js');
  const contact = async userId => {
   if (!userId) return null;
   const user = await User.getOne({ USER_MINI_OPENID: userId });
   return user ? { id: user.USER_MINI_OPENID, name: user.USER_NAME || '未填写', phone: user.USER_MOBILE || '' } : null;
  };
  const [detail, poster, rider] = await Promise.all([new Mail().getMailDetail(null, id), contact(mail.MAIL_USER_ID), contact(mail.MAIL_ACCEPT_USER_ID)]);
  return detail ? { ...detail, poster, rider } : null;
 }
 async overview() {
  const db = store.database(), pid = this.getProjectId();
  const count = async (name, where, extra = []) => {
   const conditions = [{ ...where, _pid: pid, ...(name === 'mail' ? { MAIL_ADMIN_DELETED: db.command.neq(true) } : {}) }, ...extra];
   const result = await db.collection(store.collection(name)).where(conditions.length === 1 ? conditions[0] : db.command.and(conditions)).count();
   return result.total;
  };
  const now = Date.now(), today = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  const [waiting, accepted, picked, confirming, exceptions, completed, cancelled, complaints, failedNotifications, users, pendingUsers, news, todayOrders, todayCompleted, overdue] = await Promise.all([
   ...[0, 1, 4, 2, 3, 9, 99].map(status => count('mail', { MAIL_STATUS: status })),
   count('feedback', { FB_STATUS: 0 }), count('notification', { delivery: 'failed' }),
   count('user', {}), count('user', { USER_STATUS: 0 }), count('news', {}),
   count('mail', { MAIL_ADD_TIME: db.command.gte(today) }),
   count('mail', { MAIL_STATUS: 9, MAIL_OVER_TIME: db.command.gte(today) }),
   count('mail', { MAIL_STATUS: db.command.in(rules.ACTIVE) }, [{ MAIL_DUE_TIME: db.command.gt(0) }, { MAIL_DUE_TIME: db.command.lt(now) }])
  ]);
  const delivering = accepted + picked;
  return { waiting, accepted, picked, delivering, confirming, exceptions, completed, cancelled, complaints, failedNotifications, users, pendingUsers, news, todayOrders, todayCompleted, overdue, total: waiting + delivering + confirming + exceptions + completed + cancelled };
 }
}
module.exports=OperationsService;
