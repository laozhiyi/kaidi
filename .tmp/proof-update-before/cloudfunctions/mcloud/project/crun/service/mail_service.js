'use strict';
const Base = require('./base_project_service.js');
const MailModel = require('../model/mail_model.js');
const UserModel = require('../model/user_model.js');
const ConfigService = require('./operation_config_service.js');
const store = require('./operation_store.js');
const rules = require('./order_rules.js');
const deliveryAddress = require('./delivery_address.js');
const media = require('./private_media_service.js');
const REQUEST_ROUTES = {publish:'mail/insert',edit:'mail/edit',accept:'mail/accept',pickup:'mail/pickup',cancel:'mail/cancel',deliver:'mail/deliver',confirm:'mail/finish',exception:'mail/exception',archive:'mail/del',hold:'admin/operations_hold',resolve:'admin/operations_resolve'};
class MailService extends Base {
 getStatusDesc(mail) { return rules.project(mail, '').status; }
 getFormObj(forms) { return Object.fromEntries((forms || []).map(x => [x.mark,x.val])); }
 async _user(userId) {
  if (!userId) this.AppError('请先登录');
  const user = await UserModel.getOne({ USER_MINI_OPENID:userId });
  if (!user || user.USER_STATUS !== 1) this.AppError('请先完成注册审核，或联系管理员解除停用');
  return user;
 }
 async _completeDeliveryAddresses(rows) {
  let result = rows.map(row => deliveryAddress.complete(row));
  // Fetch legacy forms only for incomplete addresses; normal list reads stay small.
  const missingForms = result.filter(row => deliveryAddress.needsPhase(row) && row.MAIL_FORMS === undefined);
  if (missingForms.length) {
   try {
    const saved = await MailModel.getAll({ _id:['in',missingForms.map(row => row._id)] },'_id,MAIL_FORMS',{},missingForms.length);
    const forms = new Map(saved.map(row => [row._id,row.MAIL_FORMS]));
    result = result.map(row => row.MAIL_FORMS === undefined && forms.has(row._id) ? deliveryAddress.complete({ ...row, MAIL_FORMS:forms.get(row._id) }) : row);
   } catch (_) { console.warn('[delivery_address] Could not read legacy order forms'); }
  }
  const userIds = [...new Set(result.filter(row => deliveryAddress.needsPhase(row)).map(row => row.MAIL_USER_ID).filter(Boolean))];
  if (!userIds.length) return result;
  try {
   const users = await UserModel.getAll({ USER_MINI_OPENID:['in',userIds] },'USER_MINI_OPENID,USER_FORMS,USER_OBJ,USER_EDIT_TIME',{},userIds.length);
   const profiles = new Map(users.map(user => [user.USER_MINI_OPENID,user]));
   return result.map(row => deliveryAddress.complete(row,profiles.get(row.MAIL_USER_ID)));
  } catch (_) { console.warn('[delivery_address] Could not read saved addresses'); return result; }
 }
 async _actor(tx, actor) {
  if (actor.adminId) { const admin = await store.get(tx,'admin',actor.adminId); if (!admin || admin._pid !== this.getProjectId() || admin.ADMIN_STATUS !== 1) this.AppError('管理员已停用'); return admin; }
  const user = await store.get(tx,'user',actor.user._id);
  if (!user || user._pid !== this.getProjectId() || user.USER_MINI_OPENID !== actor.userId || user.USER_STATUS !== 1) this.AppError('用户状态已变更');
  return user;
 }
 _request(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) this.AppError('请求标识无效，请刷新后重试'); return value; }
 async replayRequest(userId, action, input) {
  this._request(input.requestId);
  const seen = await store.get(store.database(), 'order_request', store.key(this.getProjectId(), userId, input.requestId));
  if (!seen || !seen.sourceFingerprint) return null;
  await this._user(userId);
  if (seen._pid !== this.getProjectId() || seen.action !== action || action !== 'publish' && seen.orderId !== input.id
   || seen.sourceFingerprint !== store.key(input)) this.AppError('相同请求标识不能提交不同内容');
  const mail = await store.get(store.database(), 'mail', seen.orderId);
  if (!mail || mail._pid !== this.getProjectId()) this.AppError('订单记录暂不可用，请联系管理员核对');
  return action === 'publish' ? {id:mail.MAIL_ID,_id:seen.orderId,fee:mail.MAIL_TOTAL_FEE/100,paymentMode:mail.MAIL_PAYMENT_MODE}
   : {id:seen.orderId,statusDesc:this.getStatusDesc(mail)};
 }
 async _seed(userId, role) {
  if (await store.get(store.database(), 'order_quota', store.key(this.getProjectId(), userId, role))) return [];
  return (await MailModel.getAll({ [role === 'rider' ? 'MAIL_ACCEPT_USER_ID' : 'MAIL_USER_ID']:userId, MAIL_STATUS:['in',role === 'rider' ? rules.ACTIVE : [0,...rules.ACTIVE]] },'_id',{},1000)).map(x => x._id);
 }
 async _quota(tx, userId, role, orderId, add, maximum, seed = []) {
  const id = store.key(this.getProjectId(),userId,role); const old = await store.get(tx,'order_quota',id);
  if (!old && !add) return;
  let active = [...new Set(old && old.active || seed)].filter(x => x !== orderId);
  // A legacy seed was read before the transaction. Recheck it in the transaction
  // so a concurrent completion/cancellation cannot reserve a dead slot forever.
  if (add && (!old || active.length >= maximum)) {
   const current = [];
   for (const candidate of active) {
    const row = await store.get(tx, 'mail', candidate);
    if (row && row._pid === this.getProjectId() && row[role === 'rider' ? 'MAIL_ACCEPT_USER_ID' : 'MAIL_USER_ID'] === userId
     && (rules.ACTIVE.includes(row.MAIL_STATUS) || role === 'poster' && row.MAIL_STATUS === 0 && row.MAIL_END_TIME > Date.now())) current.push(candidate);
   }
   active = current;
  }
  if (add) { if (active.length >= maximum) this.AppError('当前进行中的订单已达上限'); active.push(orderId); }
  await store.set(tx,'order_quota',id,{ _pid:this.getProjectId(), userId, role, active, updatedAt:Date.now() });
 }
 async _record(tx, mail, actor, action, requestId, note = '', fingerprint = '', sourceFingerprint = '') {
  const now = Date.now(); const version = Number(mail.MAIL_VERSION || 0) + 1;
  const event = { id:store.key(mail._id,version), action, status:mail.MAIL_STATUS, at:now, actor:actor.adminId ? 'admin' : actor.userId === mail.MAIL_USER_ID ? 'poster' : 'rider', note };
  mail.MAIL_VERSION = version; mail.MAIL_EDIT_TIME = now;
  mail.MAIL_HISTORY = [...(Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY : []),event].slice(-100);
  await store.set(tx,'mail',mail._id,mail);
  await store.set(tx,'order_event',event.id,{ _pid:this.getProjectId(), orderId:mail._id, ...event, proof:mail.MAIL_DELIVERY_PROOF || null, exception:mail.MAIL_EXCEPTION || null, actorId:actor.adminId || actor.userId });
  await store.set(tx,'order_request',store.key(this.getProjectId(),actor.adminId || actor.userId,requestId),{ _pid:this.getProjectId(), orderId:mail._id, action, fingerprint, sourceFingerprint, createdAt:now });
  // Only an opaque revision leaves the server. The signal and order commit
  // together; 64 shards avoid a single global counter on every order write.
  const shard = parseInt(store.key(mail._id).slice(0, 8), 16) % 64;
  await store.set(tx, 'order_feed', this.getProjectId() + '_' + shard, {
   _pid: this.getProjectId(), shard, revision: event.id, updatedAt: now
  });
  for (const userId of new Set([mail.MAIL_USER_ID,mail.MAIL_ACCEPT_USER_ID].filter(Boolean))) {
   await store.set(tx,'notification',store.key(event.id,userId),{ _pid:this.getProjectId(), userId, orderId:mail._id, title:'订单状态更新', content:rules.LABELS[mail.MAIL_STATUS], action, createdAt:now, read:false, delivery:'pending', attempts:0, nextAttemptAt:now });
  }
 }
 async insertMail(userId, input) {
  const user = await this._user(userId), now = Date.now();
  this._request(input.requestId); const fingerprint=store.key(input);
  const id = store.key(this.getProjectId(),userId,input.requestId), seed = await this._seed(userId,'poster');
  return store.transaction(async tx => {
   const currentUser = await this._actor(tx,{userId,user}); const old = await store.get(tx,'mail',id);
   if (old) { if (old.MAIL_PUBLISH_FINGERPRINT!==fingerprint) this.AppError('相同请求标识不能提交不同内容'); if (old._pid !== this.getProjectId() || old.MAIL_USER_ID !== userId) this.AppError('订单标识冲突'); return {id:old.MAIL_ID,_id:id,fee:old.MAIL_TOTAL_FEE/100,paymentMode:old.MAIL_PAYMENT_MODE}; }
   if(await store.get(tx,'order_request',store.key(this.getProjectId(),userId,input.requestId)))this.AppError('请求标识已被使用');
   await store.assertRequestOpen(tx,this.getProjectId(),userId,REQUEST_ROUTES.publish,input.requestId);
   await store.limitInTransaction(tx,this.getProjectId(),userId,'publish',10,60000);
   const config = await new ConfigService().getConfig(tx);
   const normalized=rules.validateForms(input.forms,config,Date.now(),currentUser);rules.requireOpen(config,Date.now());
   await this._quota(tx,userId,'poster',id,true,config.maxOpenOrders,seed);
   const mail = { _id:id,_pid:this.getProjectId(),MAIL_ID:'MAIL'+id.slice(0,28),MAIL_PUBLISH_FINGERPRINT:fingerprint,MAIL_STATUS:0,MAIL_USER_ID:userId,MAIL_USER_NAME:user.USER_NAME,MAIL_ACCEPT_USER_ID:'',MAIL_ORDER:9999,MAIL_CATE_ID:String(input.cateId || '1'),MAIL_CATE_NAME:'快递代取',MAIL_OBJ:normalized.obj,MAIL_FORMS:normalized.forms,MAIL_END_TIME:normalized.endTime,MAIL_TOTAL_FEE:normalized.totalFee,MAIL_PAYMENT_MODE:'offline',MAIL_PAY_STATUS:0,MAIL_ADD_TIME:now,MAIL_ACCEPT_TIME:0,MAIL_OVER_TIME:0,MAIL_DELIVERY_MINUTES:normalized.obj.urgent ? config.urgentMinutes : config.deliveryMinutes };
   await this._record(tx,mail,{userId},'publish',input.requestId,'发布订单；线下结算',fingerprint,input._sourceFingerprint || '');
   return {id:mail.MAIL_ID,_id:id,fee:normalized.totalFee/100,paymentMode:'offline'};
  });
 }
 async _change(userId, id, action, input = {}, adminId = '') {
  this._request(input.requestId); if (typeof id !== 'string' || !id || id.length > 100) this.AppError('订单标识无效');
  const actor = adminId ? {adminId} : {userId,user:await this._user(userId)};
  const seed = action === 'accept' ? await this._seed(userId,'rider') : [];
  return store.transaction(async tx => {
   const currentUser = await this._actor(tx,actor);
   const mail = await store.get(tx,'mail',id); if (!mail || mail._pid !== this.getProjectId()) this.AppError('订单不存在'); mail._id = id;
   const seen = await store.get(tx,'order_request',store.key(this.getProjectId(),adminId || userId,input.requestId));
   if (seen) { if (seen.orderId !== id || seen.action !== action || seen.fingerprint !== store.key(input)) this.AppError('请求标识已被使用'); return {id,statusDesc:this.getStatusDesc(mail)}; }
   await store.assertRequestOpen(tx,this.getProjectId(),adminId || userId,REQUEST_ROUTES[action],input.requestId);
   await store.limitInTransaction(tx,this.getProjectId(),adminId || userId,'order_action',30,60000);
   const config = await new ConfigService().getConfig(tx);
   const poster = mail.MAIL_USER_ID === userId, rider = mail.MAIL_ACCEPT_USER_ID === userId, oldRider = mail.MAIL_ACCEPT_USER_ID;
   const state = mail.MAIL_STATUS, now = Date.now(); let note = '';
   if (action !== 'accept' && !adminId && !poster && !rider) this.AppError('无权限操作该订单');
   if (action === 'accept') {
    rules.requireOpen(config,now);
    if (state !== 0 || mail.MAIL_ACCEPT_USER_ID) this.AppError('该订单已被接取或状态已变化，请查看其他订单');
    if (poster) this.AppError('不能接取自己发布的订单');
    if (mail.MAIL_END_TIME <= now) this.AppError('该订单已超过接单截止时间');
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
    if(!adminId || ![0,1,2,4].includes(state))this.AppError('仅管理员可将未结束订单转异常处理');
    note=rules.text(input.note || '', '人工介入依据',500,true);mail.MAIL_EXCEPTION={reason:'管理员介入',note,images:[],previousStatus:state,at:now};mail.MAIL_STATUS=3;
   } else if (action === 'resolve') {
    if (!adminId || state !== 3) this.AppError('仅管理员可处理异常订单'); note = rules.text(input.note || '','处理依据',500,true);
    if (!['resume','cancel','complete'].includes(input.resolution)) this.AppError('处理方式无效');
    mail.MAIL_STATUS = input.resolution === 'resume' ? mail.MAIL_EXCEPTION.previousStatus : input.resolution === 'cancel' ? 99 : 9;
    if (![0,1,2,4,9,99].includes(mail.MAIL_STATUS)) this.AppError('异常订单原状态无效'); if (mail.MAIL_STATUS === 9) mail.MAIL_OVER_TIME = now;
    mail.MAIL_EXCEPTION = {...mail.MAIL_EXCEPTION,resolution:input.resolution,resolvedAt:now,resolvedBy:adminId,result:note};
   } else if (action === 'edit') {
    if (!poster || state !== 0) this.AppError('仅可编辑尚未被接取的订单'); const normalized = rules.validateForms(input.forms,config,now,currentUser);
    if (mail.MAIL_PAYMENT_MODE !== 'offline') this.AppError('旧支付订单不可编辑，请联系管理员核对');
    Object.assign(mail,{MAIL_OBJ:normalized.obj,MAIL_FORMS:normalized.forms,MAIL_END_TIME:normalized.endTime,MAIL_TOTAL_FEE:normalized.totalFee,MAIL_DELIVERY_MINUTES:normalized.obj.urgent ? config.urgentMinutes : config.deliveryMinutes});
   } else if (action === 'archive') {
    if (!poster || ![9,99].includes(state)) this.AppError('仅可隐藏已结束的本人订单'); mail.MAIL_POSTER_ARCHIVED = true;
   } else this.AppError('不支持的订单操作');
   if ([9,99].includes(mail.MAIL_STATUS) && ![9,99].includes(state)) {
    await this._quota(tx,mail.MAIL_USER_ID,'poster',id,false,config.maxOpenOrders);
    if (oldRider) await this._quota(tx,oldRider,'rider',id,false,config.maxActiveOrders);
   }
   await this._record(tx,mail,actor,action,input.requestId,note,store.key(input),input._sourceFingerprint || '');
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
  const stored = await MailModel.getOne(id); if (!stored) return null;
  const [mail] = await this._completeDeliveryAddresses([stored]);
  await new (require('./review_service.js'))().decorateOrders(userId, [mail]);
  const result = rules.project(mail,userId);
  if (result.mypost || result.myaccept) { await this._user(userId); if (mail.MAIL_ACCEPT_USER_ID) result.acceptUser = await UserModel.getOne({USER_MINI_OPENID:mail.MAIL_ACCEPT_USER_ID},'USER_NAME,USER_MOBILE'); }
  if ((result.mypost || result.myaccept) && mail.MAIL_ACCEPT_USER_ID && mail.MAIL_ACCEPT_USER_ID !== mail.MAIL_USER_ID) result.MAIL_FEEDBACK_TARGET = {
   name: result.mypost ? mail.MAIL_ACCEPT_USER_NAME || '接单人' : mail.MAIL_USER_NAME || (mail.MAIL_OBJ || {}).poster || '发布者', role: result.mypost ? '接单人' : '发布者'
  };
  const favorite = (await new (require('./fav_service.js'))().orderStats(userId, [id], [mail])).list[0];
  Object.assign(result, { MAIL_FAV_CNT: favorite.count, MAIL_IS_FAV: favorite.isFav, MAIL_CAN_FAV: favorite.available });
  return media.order(result);
 }
 async getMailDetail(userId,id) {
  const stored = await MailModel.getOne(id); if (!stored) return null;
  if (userId !== null) { await this._user(userId); if (stored.MAIL_USER_ID !== userId) this.AppError('无权限查看该订单'); }
  const [mail] = await this._completeDeliveryAddresses([stored]);
  return media.order(rules.project(mail,userId,userId === null));
 }
 async getMailList(userId,input) {
  let {search,sortType,sortVal,whereEx,page=1,size=20} = input;
  if (!Number.isInteger(page) || page < 1 || page > 500 || !Number.isInteger(size) || size < 1 || size > 50) this.AppError('分页参数无效');
  const where = {and:{_pid:this.getProjectId()}};
  const now = Date.now();
  const completedSince = now - 12 * 60 * 60 * 1000;
  if (search === '我的发布') sortType = 'my_post'; if (search === '我的接单') sortType = 'my_accept';
  if (['my_post','my_accept','my_done','status','timeout'].includes(sortType)) {
   await this._user(userId);
   if (sortType === 'my_post') { where.and.MAIL_USER_ID = userId; where.and.MAIL_POSTER_ARCHIVED = ['<>',true]; }
   if (sortType === 'my_accept') { where.and.MAIL_ACCEPT_USER_ID = userId; where.and.MAIL_RIDER_ARCHIVED = ['<>',true]; }
   if (['my_post','my_accept'].includes(sortType)) {
    // 已完成订单仅在完成后的 12 小时内显示；其他状态保持原有可见性。
    where.or = [{ MAIL_STATUS: ['in', rules.ACTIVE] }, { MAIL_STATUS: ['in', [0, 99]], MAIL_END_TIME: ['>=', now] }, { MAIL_STATUS: 9, MAIL_OVER_TIME: ['>=', completedSince] }];
   }
   if (['my_done','status','timeout'].includes(sortType)) { where.or = [{MAIL_USER_ID:userId},{MAIL_ACCEPT_USER_ID:userId}]; const state = sortType === 'my_done' ? 9 : sortType === 'timeout' ? 0 : Number(sortVal); if (![0,1,2,3,4,9,99].includes(state)) this.AppError('该订单校区暂不在服务范围'); where.and.MAIL_STATUS = state; if (sortType === 'my_done') where.and.MAIL_OVER_TIME = ['>=', completedSince]; if (sortType === 'timeout') where.and.MAIL_END_TIME = ['<',now]; }
  } else { where.and.MAIL_STATUS = 0; where.and.MAIL_PAYMENT_MODE = 'offline'; where.and.MAIL_END_TIME = ['>',now]; if (sortType === 'wait') where.and.MAIL_USER_ID = ['<>',userId]; }
  if (search && !['我的发布','我的接单'].includes(search)) { const q = rules.text(search,'搜索关键词',30,true); where.and['MAIL_OBJ.title'] = ['like',q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')]; }
  if (whereEx) {
   for (const [name,value] of Object.entries(whereEx)) {
    if (name === 'MAIL_OBJ.urgent' && typeof value === 'boolean') where.and[name] = value;
    else if (name === 'MAIL_OBJ.campus' && typeof value === 'string') where.and[name] = rules.text(value,'校区',30,true);
    // 兼容旧版地点参数，地点筛选统一匹配送达地址。
    else if (['MAIL_OBJ.address2', 'MAIL_OBJ.address1'].includes(name) && Array.isArray(value) && value.length === 2 && value[0] === 'like' && ['一期','二期','三期','四期','五期'].includes(value[1])) where.and['MAIL_OBJ.address2'] = value;
    else this.AppError('不允许的筛选条件');
   }
  }
  let order = {MAIL_ADD_TIME:'desc'};
  if (input.orderBy && Object.keys(input.orderBy).length) { if (Object.keys(input.orderBy).length !== 1 || !['MAIL_ADD_TIME','MAIL_OBJ.price'].includes(Object.keys(input.orderBy)[0]) || !['asc','desc'].includes(Object.values(input.orderBy)[0])) this.AppError('排序参数无效'); order = input.orderBy; }
  order = { ...order, _id: 'desc' };
  // Lists do not need history, proof images or complete form payloads.
  const fields = '_id,_pid,MAIL_ID,MAIL_USER_ID,MAIL_ACCEPT_USER_ID,MAIL_STATUS,MAIL_END_TIME,MAIL_ADD_TIME,MAIL_ACCEPT_TIME,MAIL_PICKUP_TIME,MAIL_OVER_TIME,MAIL_TOTAL_FEE,MAIL_PAYMENT_MODE,MAIL_CATE_ID,MAIL_CATE_NAME,MAIL_DUE_TIME,MAIL_DELIVERED_TIME,MAIL_OBJ,MAIL_VERSION';
  const field = Object.keys(order)[0], direction = order[field];
  const cursor = input.cursor;
  if (cursor && (typeof cursor !== 'object' || cursor.field !== field || cursor.direction !== direction
   || typeof cursor.id !== 'string' || !/^[\w-]{1,128}$/.test(cursor.id) || !Number.isFinite(cursor.value))) this.AppError('订单分页位置无效，请刷新列表');
  const query = cursor ? { and: [where, { or: [
   { [field]: [direction === 'asc' ? '>' : '<', cursor.value] },
   { [field]: cursor.value, _id: ['<', cursor.id] }
  ] }] } : where;
  const [rows, total] = await Promise.all([
   cursor || page === 1 ? MailModel.getAll(JSON.parse(JSON.stringify(query)), fields, order, size + 1)
    : MailModel.getList(JSON.parse(JSON.stringify(query)), fields, order, page, size, false, 0).then(result => result.list),
   MailModel.count(JSON.parse(JSON.stringify(where)))
  ]);
  const list = await this._completeDeliveryAddresses(rows.slice(0, size)), last = list[list.length - 1];
  const value = last && (field === 'MAIL_ADD_TIME' ? last.MAIL_ADD_TIME : (last.MAIL_OBJ || {}).price);
  const result = { list, page, size, total, count: Math.ceil(total / size),
   hasMore: cursor || page === 1 ? rows.length > size : page * size < total,
   nextCursor: last && Number.isFinite(value) ? { field, direction, value, id: last._id } : null };
  await new (require('./review_service.js'))().decorateOrders(userId, result.list);
  const publicList = !['my_post','my_accept','my_done','status','timeout'].includes(sortType);
  const favorites = publicList ? (await new (require('./fav_service.js'))().orderStats(userId, result.list.map(row => row._id), result.list)).list : [];
  const favoriteMap = new Map(favorites.map(row => [row.id, row]));
  result.list = result.list.map(row => {
   const dto=rules.project(row,userId);
   for(const key of ['MAIL_FORMS','MAIL_HISTORY','MAIL_EXCEPTION','MAIL_DELIVERY_PROOF'])delete dto[key];
   delete dto.MAIL_OBJ.imgUrls;delete dto.MAIL_OBJ.imgUrl;
   const favorite = favoriteMap.get(row._id);
   if (favorite) Object.assign(dto, { MAIL_FAV_CNT: favorite.count, MAIL_IS_FAV: favorite.isFav, MAIL_CAN_FAV: favorite.available });
   return dto;
  }); return result;
 }
}
module.exports = MailService;
