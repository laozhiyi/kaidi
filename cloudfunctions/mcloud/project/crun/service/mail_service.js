'use strict';
const Base = require('./base_project_service.js');
const MailModel = require('../model/mail_model.js');
const UserModel = require('../model/user_model.js');
const ConfigService = require('./operation_config_service.js');
const store = require('./operation_store.js');
const rules = require('./order_rules.js');
const media = require('./private_media_service.js');
class MailService extends Base {
 getStatusDesc(mail) { return rules.project(mail, '').status; }
 getFormObj(forms) { return Object.fromEntries((forms || []).map(x => [x.mark,x.val])); }
 async _user(userId) {
  if (!userId) this.AppError('请先登录');
  const user = await UserModel.getOne({ USER_MINI_OPENID:userId });
  if (!user || user.USER_STATUS !== 1) this.AppError('请先完成注册审核，或联系管理员解除停用');
  return user;
 }
 async _actor(tx, actor) {
  if (actor.adminId) { const admin = await store.get(tx,'admin',actor.adminId); if (!admin || admin._pid !== this.getProjectId() || admin.ADMIN_STATUS !== 1) this.AppError('管理员已停用'); return admin; }
  const user = await store.get(tx,'user',actor.user._id);
  if (!user || user._pid !== this.getProjectId() || user.USER_MINI_OPENID !== actor.userId || user.USER_STATUS !== 1) this.AppError('用户状态已变更');
  return user;
 }
 _request(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) this.AppError('请求标识无效，请刷新后重试'); return value; }
 async _seed(userId, role) { return (await MailModel.getAll({ [role === 'rider' ? 'MAIL_ACCEPT_USER_ID' : 'MAIL_USER_ID']:userId, MAIL_STATUS:['in',role === 'rider' ? rules.ACTIVE : [0,...rules.ACTIVE]] },'_id',{},1000)).map(x => x._id); }
 async _quota(tx, userId, role, orderId, add, maximum, seed = []) {
  const id = store.key(this.getProjectId(),userId,role); const old = await store.get(tx,'order_quota',id);
  if (!old && !add) return;
  let active = old && old.active || seed; active = active.filter(x => x !== orderId);
  if (add) { if (active.length >= maximum) this.AppError('当前进行中的订单已达上限'); active.push(orderId); }
  await store.set(tx,'order_quota',id,{ _pid:this.getProjectId(), userId, role, active, updatedAt:Date.now() });
 }
 async _record(tx, mail, actor, action, requestId, note = '', fingerprint = '') {
  const now = Date.now(); const version = Number(mail.MAIL_VERSION || 0) + 1;
  const event = { id:store.key(mail._id,version), action, status:mail.MAIL_STATUS, at:now, actor:actor.adminId ? 'admin' : actor.userId === mail.MAIL_USER_ID ? 'poster' : 'rider', note };
  mail.MAIL_VERSION = version; mail.MAIL_EDIT_TIME = now;
  mail.MAIL_HISTORY = [...(mail.MAIL_HISTORY || []),event].slice(-100);
  await store.set(tx,'mail',mail._id,mail);
  await store.set(tx,'order_event',event.id,{ _pid:this.getProjectId(), orderId:mail._id, ...event, proof:mail.MAIL_DELIVERY_PROOF || null, exception:mail.MAIL_EXCEPTION || null, actorId:actor.adminId || actor.userId });
  await store.set(tx,'order_request',store.key(this.getProjectId(),actor.adminId || actor.userId,requestId),{ _pid:this.getProjectId(), orderId:mail._id, action, fingerprint, createdAt:now });
  for (const userId of new Set([mail.MAIL_USER_ID,mail.MAIL_ACCEPT_USER_ID].filter(Boolean))) {
   await store.set(tx,'notification',store.key(event.id,userId),{ _pid:this.getProjectId(), userId, orderId:mail._id, title:'订单状态更新', content:rules.LABELS[mail.MAIL_STATUS], action, createdAt:now, read:false, delivery:'pending', attempts:0, nextAttemptAt:now });
  }
 }
 async insertMail(userId, input) {
  const user = await this._user(userId), now = Date.now();
  this._request(input.requestId); const fingerprint=store.key(input);
  await store.limit(this.getProjectId(),userId,'publish',10,60000);
  const id = store.key(this.getProjectId(),userId,input.requestId), seed = await this._seed(userId,'poster');
  return store.transaction(async tx => {
   await this._actor(tx,{userId,user}); const old = await store.get(tx,'mail',id);
   if (old) { if (old.MAIL_PUBLISH_FINGERPRINT!==fingerprint) this.AppError('相同请求标识不能提交不同内容'); if (old._pid !== this.getProjectId() || old.MAIL_USER_ID !== userId) this.AppError('订单标识冲突'); return {id:old.MAIL_ID,_id:id,fee:old.MAIL_TOTAL_FEE/100,paymentMode:old.MAIL_PAYMENT_MODE}; }
   if(await store.get(tx,'order_request',store.key(this.getProjectId(),userId,input.requestId)))this.AppError('请求标识已被使用');
   const config = await new ConfigService().getConfig(tx);
   const normalized=rules.validateForms(input.forms,config,Date.now());rules.requireOpen(config,Date.now());
   await this._quota(tx,userId,'poster',id,true,config.maxOpenOrders,seed);
   const mail = { _id:id,_pid:this.getProjectId(),MAIL_ID:'MAIL'+id.slice(0,28),MAIL_PUBLISH_FINGERPRINT:fingerprint,MAIL_STATUS:0,MAIL_USER_ID:userId,MAIL_USER_NAME:user.USER_NAME,MAIL_ACCEPT_USER_ID:'',MAIL_ORDER:9999,MAIL_CATE_ID:String(input.cateId || '1'),MAIL_CATE_NAME:'快递代取',MAIL_OBJ:normalized.obj,MAIL_FORMS:normalized.forms,MAIL_END_TIME:normalized.endTime,MAIL_TOTAL_FEE:normalized.totalFee,MAIL_PAYMENT_MODE:'offline',MAIL_PAY_STATUS:0,MAIL_ADD_TIME:now,MAIL_ACCEPT_TIME:0,MAIL_OVER_TIME:0,MAIL_DELIVERY_MINUTES:normalized.obj.urgent ? config.urgentMinutes : config.deliveryMinutes };
   await this._record(tx,mail,{userId},'publish',input.requestId,'发布订单；线下结算',fingerprint);
   return {id:mail.MAIL_ID,_id:id,fee:normalized.totalFee/100,paymentMode:'offline'};
  });
 }
 async _change(userId, id, action, input = {}, adminId = '') {
  this._request(input.requestId); if (typeof id !== 'string' || !id || id.length > 100) this.AppError('订单标识无效');
  const actor = adminId ? {adminId} : {userId,user:await this._user(userId)};
  const seed = action === 'accept' ? await this._seed(userId,'rider') : [];
  await store.limit(this.getProjectId(),adminId || userId,'order_action',30,60000);
  return store.transaction(async tx => {
   const currentUser = await this._actor(tx,actor);
   const mail = await store.get(tx,'mail',id); if (!mail || mail._pid !== this.getProjectId()) this.AppError('订单不存在'); mail._id = id;
   const seen = await store.get(tx,'order_request',store.key(this.getProjectId(),adminId || userId,input.requestId));
   if (seen) { if (seen.orderId !== id || seen.action !== action || seen.fingerprint !== store.key(input)) this.AppError('请求标识已被使用'); return {id,statusDesc:this.getStatusDesc(mail)}; }
   const config = await new ConfigService().getConfig(tx);
   const poster = mail.MAIL_USER_ID === userId, rider = mail.MAIL_ACCEPT_USER_ID === userId, oldRider = mail.MAIL_ACCEPT_USER_ID;
   const state = mail.MAIL_STATUS, now = Date.now(); let note = '';
   if (action !== 'accept' && !adminId && !poster && !rider) this.AppError('无权限操作该订单');
   if (action === 'accept') {
    rules.requireOpen(config,now); if (state !== 0 || mail.MAIL_ACCEPT_USER_ID || poster || mail.MAIL_END_TIME <= now) this.AppError('该订单不可接取');
    if (mail.MAIL_PAYMENT_MODE !== 'offline') this.AppError('旧支付订单须先由管理员核对，不能直接接单');
    if (!config.campuses.includes(mail.MAIL_OBJ.campus)) this.AppError('该订单校区暂不在服务范围');
    await this._quota(tx,userId,'rider',id,true,config.maxActiveOrders,seed);
    mail.MAIL_STATUS = 1; mail.MAIL_ACCEPT_USER_ID = userId; mail.MAIL_ACCEPT_USER_NAME = currentUser.USER_NAME; mail.MAIL_ACCEPT_TIME = now;
    mail.MAIL_DUE_TIME = now + (mail.MAIL_DELIVERY_MINUTES || config.deliveryMinutes) * 60000;
   } else if (action === 'pickup') {
    if (!rider || state !== 1) this.AppError('仅已接单订单可确认取件');
    mail.MAIL_STATUS = 4; mail.MAIL_PICKUP_TIME = now;
   } else if (action === 'cancel') {
    if (!poster || state !== 0) this.AppError('只有发布者可取消待接单订单；已接单请提交异常申请'); mail.MAIL_STATUS = 99; note = rules.text(input.note || '发布者取消','取消原因',300,true);
   } else if (action === 'deliver') {
    if (!rider || state !== 4) this.AppError('仅配送中的接单人可提交送达');
    const proof = rules.images(input.images || []); note = rules.text(input.note || '','送达说明',300,true);
    if (!proof.length) this.AppError('请上传送达凭证'); mail.MAIL_DELIVERY_PROOF = {images:proof,note,at:now}; mail.MAIL_DELIVERED_TIME = now; mail.MAIL_STATUS = 2;
   } else if (action === 'confirm') {
    if (!poster || state !== 2) this.AppError('仅发布者可确认已送达订单'); mail.MAIL_STATUS = 9; mail.MAIL_OVER_TIME = now; mail.MAIL_POSTER_ARCHIVED = true; mail.MAIL_RIDER_ARCHIVED = true;
   } else if (action === 'exception') {
    if (![1,2,4].includes(state)) this.AppError('当前订单不能重复提交异常');
    const allowed = ['取件失败','取件码错误','联系不上','物品损坏','送错地址','申请取消','其他']; if (!allowed.includes(input.reason)) this.AppError('异常原因无效');
    note = rules.text(input.note || '','异常说明',500,true); mail.MAIL_EXCEPTION = { reason:input.reason,note,images:rules.images(input.images || []),previousStatus:state,at:now }; mail.MAIL_STATUS = 3;
   } else if (action === 'hold') {
    if(!adminId || ![0,1,2].includes(state))this.AppError('仅管理员可将未结束订单转异常处理');
    note=rules.text(input.note || '', '人工介入依据',500,true);mail.MAIL_EXCEPTION={reason:'管理员介入',note,images:[],previousStatus:state,at:now};mail.MAIL_STATUS=3;
   } else if (action === 'resolve') {
    if (!adminId || state !== 3) this.AppError('仅管理员可处理异常订单'); note = rules.text(input.note || '','处理依据',500,true);
    if (!['resume','cancel','complete'].includes(input.resolution)) this.AppError('处理方式无效');
    mail.MAIL_STATUS = input.resolution === 'resume' ? mail.MAIL_EXCEPTION.previousStatus : input.resolution === 'cancel' ? 99 : 9;
    if (![0,1,2,4,9,99].includes(mail.MAIL_STATUS)) this.AppError('异常订单原状态无效'); if (mail.MAIL_STATUS === 9) mail.MAIL_OVER_TIME = now;
    mail.MAIL_EXCEPTION = {...mail.MAIL_EXCEPTION,resolution:input.resolution,resolvedAt:now,resolvedBy:adminId,result:note};
   } else if (action === 'edit') {
    if (!poster || state !== 0) this.AppError('仅可编辑尚未被接取的订单'); const normalized = rules.validateForms(input.forms,config,now);
    if (mail.MAIL_PAYMENT_MODE !== 'offline') this.AppError('旧支付订单不可编辑，请联系管理员核对');
    Object.assign(mail,{MAIL_OBJ:normalized.obj,MAIL_FORMS:normalized.forms,MAIL_END_TIME:normalized.endTime,MAIL_TOTAL_FEE:normalized.totalFee,MAIL_DELIVERY_MINUTES:normalized.obj.urgent ? config.urgentMinutes : config.deliveryMinutes});
   } else if (action === 'archive') {
    if (!poster || ![9,99].includes(state)) this.AppError('仅可隐藏已结束的本人订单'); mail.MAIL_POSTER_ARCHIVED = true;
   } else this.AppError('不支持的订单操作');
   if ([9,99].includes(mail.MAIL_STATUS) && ![9,99].includes(state)) {
    await this._quota(tx,mail.MAIL_USER_ID,'poster',id,false,config.maxOpenOrders);
    if (oldRider) await this._quota(tx,oldRider,'rider',id,false,config.maxActiveOrders);
   }
   await this._record(tx,mail,actor,action,input.requestId,note,store.key(input));
   return {id,statusDesc:this.getStatusDesc(mail)};
  });
 }
 async acceptMail(userId,id,input) { return this._change(userId,id,'accept',input); }
 async pickupMail(userId,id,input) { return this._change(userId,id,'pickup',input); }
 async cancelMail(userId,id,input) { return this._change(userId,id,'cancel',input); }
 async finishMail(userId,id,input) { return this._change(userId,id,'confirm',input); }
 async deliverMail(userId,id,input) { return this._change(userId,id,'deliver',input); }
 async exceptionMail(userId,id,input) { return this._change(userId,id,'exception',input); }
 async holdMail(adminId,id,input) { return this._change('',id,'hold',input,adminId); }
 async resolveMail(adminId,id,input) { return this._change('',id,'resolve',input,adminId); }
 async editMail(userId,input) { return this._change(userId,input.id,'edit',input); }
 async statusMail() { this.AppError('已禁用直接修改状态，请使用对应订单操作'); }
 async delMail(userId,id,input) { return this._change(userId,id,'archive',input); }
 async updateMailForms() { this.AppError('请在提交订单前上传图片，并通过编辑订单更新，禁止独立覆盖表单'); }
 async viewMail(userId,id) {
  const mail = await MailModel.getOne(id); if (!mail) return null;
  const result = rules.project(mail,userId);
  if (result.mypost || result.myaccept) { await this._user(userId); if (mail.MAIL_ACCEPT_USER_ID) result.acceptUser = await UserModel.getOne({USER_MINI_OPENID:mail.MAIL_ACCEPT_USER_ID},'USER_NAME,USER_MOBILE'); }
  return media.order(result);
 }
 async getMailDetail(userId,id) { const mail = await MailModel.getOne(id); if (!mail) return null; if (userId !== null) { await this._user(userId); if (mail.MAIL_USER_ID !== userId) this.AppError('无权限查看该订单'); } return media.order(rules.project(mail,userId,userId === null)); }
 async getMailList(userId,input) {
  let {search,sortType,sortVal,whereEx,page=1,size=20} = input;
  if (!Number.isInteger(page) || page < 1 || page > 500 || !Number.isInteger(size) || size < 1 || size > 50) this.AppError('分页参数无效');
  const where = {and:{_pid:this.getProjectId()}};
  if (search === '我的发布') sortType = 'my_post'; if (search === '我的接单') sortType = 'my_accept';
  if (['my_post','my_accept','my_done','status','timeout'].includes(sortType)) {
   await this._user(userId);
   if (sortType === 'my_post') { where.and.MAIL_USER_ID = userId; where.and.MAIL_POSTER_ARCHIVED = ['<>',true]; }
   if (sortType === 'my_accept') { where.and.MAIL_ACCEPT_USER_ID = userId; where.and.MAIL_RIDER_ARCHIVED = ['<>',true]; }
   if (['my_done','status','timeout'].includes(sortType)) { where.or = [{MAIL_USER_ID:userId},{MAIL_ACCEPT_USER_ID:userId}]; const state = sortType === 'my_done' ? 9 : sortType === 'timeout' ? 0 : Number(sortVal); if (![0,1,2,3,4,9,99].includes(state)) this.AppError('该订单校区暂不在服务范围'); where.and.MAIL_STATUS = state; if (sortType === 'timeout') where.and.MAIL_END_TIME = ['<',Date.now()]; }
  } else { where.and.MAIL_STATUS = 0; where.and.MAIL_PAYMENT_MODE = 'offline'; where.and.MAIL_END_TIME = ['>',Date.now()]; if (sortType === 'wait') where.and.MAIL_USER_ID = ['<>',userId]; }
  if (search && !['我的发布','我的接单'].includes(search)) { const q = rules.text(search,'搜索关键词',30,true); where.and['MAIL_OBJ.title'] = ['like',q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')]; }
  if (whereEx) {
   for (const [name,value] of Object.entries(whereEx)) {
    if (name === 'MAIL_OBJ.urgent' && typeof value === 'boolean') where.and[name] = value;
    else if (name === 'MAIL_OBJ.campus' && typeof value === 'string') where.and[name] = rules.text(value,'校区',30,true);
    else if (name === 'MAIL_OBJ.address1' && Array.isArray(value) && value[0] === 'like' && ['一期','二期','三期','四期','五期'].includes(value[1])) where.and[name] = value;
    else this.AppError('不允许的筛选条件');
   }
  }
  let order = {MAIL_ADD_TIME:'desc'};
  if (input.orderBy && Object.keys(input.orderBy).length) { if (Object.keys(input.orderBy).length !== 1 || !['MAIL_ADD_TIME','MAIL_OBJ.price'].includes(Object.keys(input.orderBy)[0]) || !['asc','desc'].includes(Object.values(input.orderBy)[0])) this.AppError('排序参数无效'); order = input.orderBy; }
  const result = await MailModel.getList(where,'*',order,page,size,true,0);
  result.list = result.list.map(row => {const dto=rules.project(row,userId);for(const key of ['MAIL_FORMS','MAIL_HISTORY','MAIL_EXCEPTION','MAIL_DELIVERY_PROOF'])delete dto[key];delete dto.MAIL_OBJ.imgUrls;delete dto.MAIL_OBJ.imgUrl;return dto;}); return result;
 }
}
module.exports = MailService;
