'use strict';
const Base = require('./base_project_service.js');
const MailModel = require('../model/mail_model.js');
const UserModel = require('../model/user_model.js');
const ConfigService = require('./operation_config_service.js');
const store = require('./operation_store.js');
const rules = require('./order_rules.js');
const profileRules = require('./profile_rules.js');
const media = require('./private_media_service.js');
const REQUEST_ROUTES = {publish:'mail/insert',edit:'mail/edit',accept:'mail/accept',pickup:'mail/pickup',cancel:'mail/cancel',deliver:'mail/deliver',update_proof:'mail/update_proof',confirm:'mail/finish',exception:'mail/exception',remind:'mail/remind',auto_confirm:'mail/auto_confirm',archive:'mail/del',hold:'admin/operations_hold',resolve:'admin/operations_resolve',admin_delete:'admin/operations_delete_order'};
// 送达后 8 小时内未确认收货，由订单维护任务自动确认。
const AUTO_CONFIRM_MS = 8 * 3600000;
// 「提醒发布人收货」的冷却：同一订单 5 分钟内只允许提醒一次，避免刷消息。
const REMIND_COOLDOWN_MS = 5 * 60000;
class MailService extends Base {
 getStatusDesc(mail) { return rules.project(mail, '').status; }
 getFormObj(forms) { return Object.fromEntries((forms || []).map(x => [x.mark,x.val])); }
 // 待审核（0）即可发单，接单仍需审核通过（1）；审核未过与被停用不可操作。
 async _user(userId, options = {}) {
  if (!userId) this.AppError('请先登录');
  const user = await UserModel.getOne({ USER_MINI_OPENID:userId });
  const allowed = user && (options.allowPending ? [0, 1].includes(user.USER_STATUS) : user.USER_STATUS === 1);
  if (!allowed) this.AppError(options.allowPending ? '请先提交注册资料，或联系管理员解除停用' : '请先完成注册审核，或联系管理员解除停用');
  if (!profileRules.isReady(user)) this.AppError('请先微信登录并补全个人资料');
  return user;
 }
 async _actor(tx, actor) {
  if (actor.adminId) { const admin = await store.get(tx,'admin',actor.adminId); const tenant = require('../../../framework/tenancy/tenant_context.js'); if (!tenant.isAdminEnabled(admin) || admin._pid !== this.getProjectId()) this.AppError('管理员已停用'); return admin; }
  const user = await store.get(tx,'user',actor.user._id);
  const allowed = user && user._pid === this.getProjectId() && user.USER_MINI_OPENID === actor.userId
   && (actor.allowPending ? [0, 1].includes(user.USER_STATUS) : user.USER_STATUS === 1);
  if (!allowed) this.AppError('用户状态已变更');
  if (!profileRules.isReady(user)) this.AppError('请先微信登录并补全个人资料');
  return user;
 }
 _request(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(value)) this.AppError('请求标识无效，请刷新后重试'); return value; }
 async replayRequest(userId, action, input) {
  this._request(input.requestId);
  const seen = await store.get(store.database(), 'order_request', store.key(this.getProjectId(), userId, input.requestId));
  if (!seen || !seen.sourceFingerprint) return null;
  await this._user(userId, { allowPending: ['publish','edit','archive','cancel'].includes(action) });
  if (seen._pid !== this.getProjectId() || seen.action !== action || action !== 'publish' && seen.orderId !== input.id
   || seen.sourceFingerprint !== store.key(input)) this.AppError('相同请求标识不能提交不同内容');
  const mail = await store.get(store.database(), 'mail', seen.orderId);
  if (!mail || mail._pid !== this.getProjectId()) this.AppError('订单记录暂不可用，请联系管理员核对');
  return action === 'publish' ? {id:mail.MAIL_ID,_id:seen.orderId,fee:mail.MAIL_TOTAL_FEE/100,paymentMode:mail.MAIL_PAYMENT_MODE}
   : {id:seen.orderId,statusDesc:this.getStatusDesc(mail)};
 }
 async _seed(userId, role) {
  if (await store.get(store.database(), 'order_quota', store.scopeKey(this.getProjectId(), userId, role))) return [];
  const rows = await MailModel.getAll({ [role === 'rider' ? 'MAIL_ACCEPT_USER_ID' : 'MAIL_USER_ID']:userId, MAIL_ADMIN_DELETED:['<>',true], MAIL_STATUS:['in',role === 'rider' ? rules.ACTIVE : [0,...rules.ACTIVE]] },'_id',{},1000);
  if (rows.length >= 1000) this.AppError('历史在途订单数量异常，请先完成配额核验');
  return rows.map(x => x._id);
 }
 async _quota(tx, userId, role, orderId, add, maximum, seed = []) {
  const id = store.scopeKey(this.getProjectId(),userId,role); const old = await store.get(tx,'order_quota',id);
  if (!old && !add) return;
  let active = [...new Set(old && old.active || seed)].filter(x => x !== orderId);
  // A legacy seed was read before the transaction. Recheck it in the transaction
  // so a concurrent completion/cancellation cannot reserve a dead slot forever.
  if (add && (!old || active.length >= maximum)) {
   const current = [];
   for (const candidate of active) {
    const row = await store.get(tx, 'mail', candidate);
    if (row && row.MAIL_ADMIN_DELETED !== true && row._pid === this.getProjectId() && row[role === 'rider' ? 'MAIL_ACCEPT_USER_ID' : 'MAIL_USER_ID'] === userId
     && (rules.ACTIVE.includes(row.MAIL_STATUS) || role === 'poster' && row.MAIL_STATUS === 0 && row.MAIL_END_TIME > Date.now())) current.push(candidate);
   }
   active = current;
  }
  if (add) { if (active.length >= maximum) this.AppError('当前进行中的订单已达上限'); active.push(orderId); }
  await store.set(tx,'order_quota',id,{ _pid:this.getProjectId(), userId, role, active, updatedAt:Date.now() });
 }
 async _record(tx, mail, actor, action, requestId, note = '', fingerprint = '', sourceFingerprint = '', message = null) {
  await store.assertRequestScope(tx,this.getProjectId(),actor.adminId || actor.userId,REQUEST_ROUTES[action] || action,requestId);
  const now = Date.now(); const version = Number(mail.MAIL_VERSION || 0) + 1;
  const event = { id:store.key(mail._id,version), action, status:mail.MAIL_STATUS, at:now, actor:actor.adminId ? 'admin' : actor.userId === mail.MAIL_USER_ID ? 'poster' : 'rider', note };
  mail.MAIL_VERSION = version; mail.MAIL_EDIT_TIME = now;
  mail.workerShard=parseInt(store.key(mail._id).slice(0,8),16)%16;
  mail.MAIL_HISTORY = [...(Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY : []),event].slice(-100);
  await store.set(tx,'mail',mail._id,mail);
  await store.set(tx,'order_event',event.id,{ _pid:this.getProjectId(), orderId:mail._id, ...event, proof:mail.MAIL_DELIVERY_PROOF || null, exception:mail.MAIL_EXCEPTION || null, actorId:actor.adminId || actor.userId });
  await store.set(tx,'order_request',store.key(this.getProjectId(),actor.adminId || actor.userId,requestId),{ _pid:this.getProjectId(), orderId:mail._id, action, fingerprint, sourceFingerprint, createdAt:now });
  // Only an opaque revision leaves the server. The signal and order commit
  // together; 64 shards avoid a single global counter on every order write.
  const shard = parseInt(store.key(mail._id).slice(0, 8), 16) % 64;
  const scope = store.scope();
  await store.set(tx, 'order_feed', scope ? store.scopeKey(this.getProjectId(), 'feed', shard) : this.getProjectId() + '_' + shard, {
   _pid: this.getProjectId(), shard, revision: event.id, updatedAt: now
  });
  const title = message && message.title || (action === 'update_proof' ? '送达凭证已更新' : '订单状态更新');
  const content = message && message.content || (action === 'update_proof' ? '骑手已更新送达说明或照片，请核对后确认收货' : rules.LABELS[mail.MAIL_STATUS]);
  const recipients = message && message.only === 'poster' ? [mail.MAIL_USER_ID] : [mail.MAIL_USER_ID, mail.MAIL_ACCEPT_USER_ID];
  for (const userId of new Set(recipients.filter(Boolean))) {
   await store.set(tx,'notification',store.key(event.id,userId),{ _pid:this.getProjectId(), userId, orderId:mail._id, title, content, action, createdAt:now, read:false, delivery:'pending', attempts:0, nextAttemptAt:now });
  }
 }
 async insertMail(userId, input) {
  const user = await this._user(userId, {allowPending:true}), now = Date.now();
  this._request(input.requestId); const fingerprint=store.key(input);
  const id = store.key(this.getProjectId(),userId,input.requestId), seed = await this._seed(userId,'poster');
  return store.transaction(async tx => {
   await this._actor(tx,{userId,user,allowPending:true}); const old = await store.get(tx,'mail',id);
   if (old) { if (old.MAIL_PUBLISH_FINGERPRINT!==fingerprint) this.AppError('相同请求标识不能提交不同内容'); if (old._pid !== this.getProjectId() || old.MAIL_USER_ID !== userId) this.AppError('订单标识冲突'); return {id:old.MAIL_ID,_id:id,fee:old.MAIL_TOTAL_FEE/100,paymentMode:old.MAIL_PAYMENT_MODE}; }
   if(await store.get(tx,'order_request',store.key(this.getProjectId(),userId,input.requestId)))this.AppError('请求标识已被使用');
   await store.assertRequestOpen(tx,this.getProjectId(),userId,REQUEST_ROUTES.publish,input.requestId);
   await store.limitInTransaction(tx,this.getProjectId(),userId,'publish',10,60000);
   const config = await new ConfigService().getConfig(tx);
   const normalized=rules.validateForms(input.forms,config,Date.now());rules.requireOpen(config,Date.now());
   await this._quota(tx,userId,'poster',id,true,config.maxOpenOrders,seed);
   const mail = { _id:id,_pid:this.getProjectId(),MAIL_ID:'MAIL'+id.slice(0,28),MAIL_PUBLISH_FINGERPRINT:fingerprint,MAIL_STATUS:0,MAIL_USER_ID:userId,MAIL_USER_NAME:user.USER_NAME,MAIL_ACCEPT_USER_ID:'',MAIL_ORDER:9999,MAIL_CATE_ID:rules.SERVICES[normalized.obj.serviceType].id,MAIL_CATE_NAME:rules.SERVICES[normalized.obj.serviceType].name,MAIL_OBJ:normalized.obj,MAIL_FORMS:normalized.forms,MAIL_END_TIME:normalized.endTime,MAIL_EXPECT_START:normalized.expectStart,MAIL_EXPECT_TIME:normalized.expectTime || normalized.endTime,MAIL_TOTAL_FEE:normalized.totalFee,MAIL_PAYMENT_MODE:'offline',MAIL_PAY_STATUS:0,MAIL_ADD_TIME:now,MAIL_ACCEPT_TIME:0,MAIL_OVER_TIME:0,MAIL_DELIVERY_MINUTES:normalized.obj.urgent ? config.urgentMinutes : config.deliveryMinutes };
   mail.MAIL_SCHEMA_VERSION=normalized.schemaVersion; mail.MAIL_RULE_SNAPSHOT=normalized.ruleSnapshot;
   await this._record(tx,mail,{userId},'publish',input.requestId,'发布订单；线下结算',fingerprint,input._sourceFingerprint || '');
   return {id:mail.MAIL_ID,_id:id,fee:normalized.totalFee/100,paymentMode:'offline'};
  });
 }
 async _change(userId, id, action, input = {}, adminId = '') {
  this._request(input.requestId); if (typeof id !== 'string' || !id || id.length > 100) this.AppError('订单标识无效');
  // 发布人改单、撤销、删除自己的待接单订单不要求审核通过；接单与履约仍要求正常账号。
  const allowPending = ['edit','archive','cancel'].includes(action);
  const actor = adminId ? {adminId} : {userId,allowPending,user:await this._user(userId,{allowPending})};
  const seed = action === 'accept' ? await this._seed(userId,'rider') : [];
  return store.transaction(async tx => {
   const currentUser = await this._actor(tx,actor);
   const mail = await store.get(tx,'mail',id); if (!mail || mail.MAIL_ADMIN_DELETED === true || mail._pid !== this.getProjectId()) this.AppError('订单不存在'); mail._id = id;
   const seen = await store.get(tx,'order_request',store.key(this.getProjectId(),adminId || userId,input.requestId));
   if (seen) { if (seen.orderId !== id || seen.action !== action || seen.fingerprint !== store.key(input)) this.AppError('请求标识已被使用'); return {id,statusDesc:this.getStatusDesc(mail)}; }
   await store.assertRequestOpen(tx,this.getProjectId(),adminId || userId,REQUEST_ROUTES[action],input.requestId);
   await store.limitInTransaction(tx,this.getProjectId(),adminId || userId,'order_action',30,60000);
   const config = await new ConfigService().getConfig(tx);
   const poster = mail.MAIL_USER_ID === userId, rider = mail.MAIL_ACCEPT_USER_ID === userId, oldRider = mail.MAIL_ACCEPT_USER_ID;
   const state = mail.MAIL_STATUS, now = Date.now(); let note = '', message = null;
   if (action !== 'accept' && !adminId && !poster && !rider) this.AppError('无权限操作该订单');
   if (action === 'accept') {
    rules.requireOpen(config,now);
    if (state !== 0 || mail.MAIL_ACCEPT_USER_ID) this.AppError('该订单已被接取或状态已变化，请查看其他订单');
    if (poster) this.AppError('不能接取自己发布的订单');
    if (mail.MAIL_END_TIME <= now) this.AppError('该订单已超过接单截止时间');
    if (mail.MAIL_PAYMENT_MODE !== 'offline') this.AppError('旧支付订单须先由管理员核对，不能直接接单');
    if (!store.scope() && !config.campuses.includes(mail.MAIL_OBJ.campus)) this.AppError('该订单校区暂不在服务范围');
    await this._quota(tx,userId,'rider',id,true,config.maxActiveOrders,seed);
    mail.MAIL_STATUS = 1; mail.MAIL_ACCEPT_USER_ID = userId; mail.MAIL_ACCEPT_USER_NAME = currentUser.USER_NAME; mail.MAIL_ACCEPT_TIME = now;
    // 期待送达时间是「最早 ~ 最晚」区间：在区间最晚时间内送达都不算超时。
    const expectEnd = Number(mail.MAIL_EXPECT_TIME) || 0;
    mail.MAIL_DUE_TIME = expectEnd > now ? expectEnd : now + (mail.MAIL_DELIVERY_MINUTES || config.deliveryMinutes) * 60000;
   } else if (action === 'pickup') {
    if (!rider || state !== 1) this.AppError('仅已接单订单可确认取件');
    // 取件须留证：照片（最多10张）与视频（1段15秒）二选一，有其一即可。
    const proof = rules.images(input.images || []), video = rules.videos(input.videos || [])[0] || '';
    if (!proof.length && !video) this.AppError('取件请上传至少1张凭证照片或1段视频');
    mail.MAIL_PICKUP_PROOF = {images:proof, video, note:rules.text(input.note || '','取件说明',300,false), at:now};
    mail.MAIL_STATUS = 4; mail.MAIL_PICKUP_TIME = now;
   } else if (action === 'cancel') {
    if (!poster || state !== 0) this.AppError('只有发布者可取消待接单订单；已接单请提交异常申请'); mail.MAIL_STATUS = 99; note = rules.text(input.note || '发布者取消','取消原因',300,true);
   } else if (action === 'deliver') {
    if (!rider || state !== 4) this.AppError('仅配送中的接单人可提交送达');
    // 两种送达方式：放置指定位置（须凭证）/ 当面交付（由发布人确认收货）。
    const mode = input.mode === 'face' ? 'face' : 'place';
    // 送达凭证同样是照片 / 视频二选一。
    const proof = rules.images(input.images || []), video = rules.videos(input.videos || [])[0] || '';
    note = rules.text(input.note || '','送达说明',300,mode !== 'face');
    if (mode === 'place' && !proof.length && !video) this.AppError('放置指定位置请上传至少1张凭证照片或1段视频');
    mail.MAIL_DELIVERY_PROOF = {images:proof, video, note, mode, at:now};
    mail.MAIL_DELIVERED_TIME = now; mail.MAIL_STATUS = 2;
    mail.MAIL_AUTO_CONFIRM_AT = now + AUTO_CONFIRM_MS;
    message = { title: mode === 'face' ? '骑手已当面交付' : '骑手已放置包裹',
     content: mode === 'face' ? '骑手已当面交付，请核对后确认收货；送达满8小时将自动确认收货' : '骑手已放置包裹并上传凭证，请核对后确认收货；送达满8小时将自动确认收货' };
   } else if (action === 'update_proof') {
    if (!rider || state !== 2 || !mail.MAIL_DELIVERY_PROOF) this.AppError('仅待收货订单的接单骑手可更新送达凭证');
    const proof = rules.images(input.images || []); note = rules.text(input.note || '','送达说明',300,mail.MAIL_DELIVERY_PROOF.mode !== 'face');
    const mode = mail.MAIL_DELIVERY_PROOF.mode === 'face' ? 'face' : 'place';
    const video = rules.videos(input.videos === undefined ? (mail.MAIL_DELIVERY_PROOF.video ? [mail.MAIL_DELIVERY_PROOF.video] : []) : input.videos)[0] || '';
    if (mode === 'place' && !proof.length && !video) this.AppError('请至少保留1张送达照片或1段视频');
    mail.MAIL_DELIVERY_PROOF = {...mail.MAIL_DELIVERY_PROOF,images:proof,video,note,updatedAt:now};
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
    if (!poster || state !== 0) this.AppError('仅可编辑尚未被接取的订单'); const normalized = rules.validateForms(input.forms,config,now);
    if (normalized.obj.serviceType !== (mail.MAIL_OBJ.serviceType || 'take')) this.AppError('不能修改订单服务类型');
    if (mail.MAIL_PAYMENT_MODE !== 'offline') this.AppError('旧支付订单不可编辑，请联系管理员核对');
    Object.assign(mail,{MAIL_CATE_ID:rules.SERVICES[normalized.obj.serviceType].id,MAIL_CATE_NAME:rules.SERVICES[normalized.obj.serviceType].name,MAIL_OBJ:normalized.obj,MAIL_FORMS:normalized.forms,MAIL_END_TIME:normalized.endTime,MAIL_EXPECT_START:normalized.expectStart,MAIL_EXPECT_TIME:normalized.expectTime || normalized.endTime,MAIL_TOTAL_FEE:normalized.totalFee,MAIL_DELIVERY_MINUTES:normalized.obj.urgent ? config.urgentMinutes : config.deliveryMinutes});
    mail.MAIL_SCHEMA_VERSION=normalized.schemaVersion; mail.MAIL_RULE_SNAPSHOT=normalized.ruleSnapshot;
   } else if (action === 'archive') {
    if (!poster || ![9,99].includes(state)) this.AppError('仅可隐藏已结束的本人订单'); mail.MAIL_POSTER_ARCHIVED = true;
   } else this.AppError('不支持的订单操作');
   if ([9,99].includes(mail.MAIL_STATUS) && ![9,99].includes(state)) {
    await this._quota(tx,mail.MAIL_USER_ID,'poster',id,false,config.maxOpenOrders);
    if (oldRider) await this._quota(tx,oldRider,'rider',id,false,config.maxActiveOrders);
   }
   await this._record(tx,mail,actor,action,input.requestId,note,store.key(input),input._sourceFingerprint || '',message);
   return {id,statusDesc:this.getStatusDesc(mail)};
  });
 }
 // 送达后 8 小时未确认收货，系统自动确认（见 maintenance_service）。
 static get AUTO_CONFIRM_MS() { return AUTO_CONFIRM_MS; }
 static get REMIND_COOLDOWN_MS() { return REMIND_COOLDOWN_MS; }
 async acceptMail(userId,id,input) { return this._change(userId,id,'accept',input); }
 async pickupMail(userId,id,input) { return this._change(userId,id,'pickup',input); }
 async remindReceipt(userId,id,input = {}) {
  this._request(input.requestId);
  if (typeof id !== 'string' || !id || id.length > 100) this.AppError('订单标识无效');
  const user = await this._user(userId);
  return store.transaction(async tx => {
   await this._actor(tx,{userId,user});
   const mail = await store.get(tx,'mail',id);
   if (!mail || mail._pid !== this.getProjectId() || mail.MAIL_ADMIN_DELETED === true) this.AppError('订单不存在');
   mail._id = id;
   if (mail.MAIL_ACCEPT_USER_ID !== userId) this.AppError('仅接单骑手可提醒发布人收货');
   if (mail.MAIL_STATUS !== 2) this.AppError('当前订单无需提醒收货');
   const now = Date.now(), last = Number(mail.MAIL_REMIND_AT) || 0;
   // 冷却期内不再推送，避免骑手连续点击把发布人的消息刷满。
   if (last > 0 && now - last < REMIND_COOLDOWN_MS) {
    const wait = Math.max(1, Math.ceil((REMIND_COOLDOWN_MS - (now - last)) / 60000));
    this.AppError('已经提醒过发布人，请 ' + wait + ' 分钟后再试');
   }
   await store.assertRequestOpen(tx,this.getProjectId(),userId,'mail/remind',input.requestId);
   await store.limitInTransaction(tx,this.getProjectId(),userId,'order_action',30,60000);
   // 不暴露发布人联系方式：只推送一条站内提醒，由发布人自行确认收货。
   const eventId = store.key(id,'remind',now);
   mail.MAIL_REMIND_AT = now;
   await store.set(tx,'mail',id,mail);
   await store.set(tx,'notification',store.key(eventId,mail.MAIL_USER_ID),{ _pid:this.getProjectId(), userId:mail.MAIL_USER_ID, orderId:id, title:'骑手提醒你确认收货', content:'骑手已送达，请核对后及时确认收货；送达满8小时将自动确认收货', action:'remind', createdAt:now, read:false, delivery:'pending', attempts:0, nextAttemptAt:now });
   await store.set(tx,'order_request',store.key(this.getProjectId(),userId,input.requestId),{ _pid:this.getProjectId(), orderId:id, action:'remind', fingerprint:store.key(input), sourceFingerprint:input._sourceFingerprint || '', createdAt:now });
   return {id,reminded:true,nextRemindAt:now + REMIND_COOLDOWN_MS};
  });
 }
 async cancelMail(userId,id,input) { return this._change(userId,id,'cancel',input); }
 async finishMail(userId,id,input) { return this._change(userId,id,'confirm',input); }
 async deliverMail(userId,id,input) { return this._change(userId,id,'deliver',input); }
 async updateDeliveryProof(userId,id,input) { return this._change(userId,id,'update_proof',input); }
 async getDeliveryProofForUpdate(userId,id) {
  await this._user(userId);
  const mail = await MailModel.getOne(id);
  if (!mail || mail._pid !== this.getProjectId()) this.AppError('订单不存在');
  if (mail.MAIL_ACCEPT_USER_ID !== userId || mail.MAIL_STATUS !== 2 || !mail.MAIL_DELIVERY_PROOF) this.AppError('仅待收货订单的接单骑手可更新送达凭证');
  return mail.MAIL_DELIVERY_PROOF;
 }
 async exceptionMail(userId,id,input) { return this._change(userId,id,'exception',input); }
 async holdMail(adminId,id,input) { return this._change('',id,'hold',input,adminId); }
 async resolveMail(adminId,id,input) { return this._change('',id,'resolve',input,adminId); }
 async deleteOrder(adminId,id,input) {
  if (!adminId) this.AppError('仅管理员可删除订单');
  if (typeof id !== 'string' || !id || id.length > 100) this.AppError('订单标识无效');
  this._request(input.requestId);
  return store.transaction(async tx => {
   await this._actor(tx,{adminId});
   const mail = await store.get(tx,'mail',id);
   if (!mail || mail._pid !== this.getProjectId()) this.AppError('订单不存在');
   mail._id = id;
   const fingerprint = store.key(input), requestKey = store.key(this.getProjectId(),adminId,input.requestId);
   const seen = await store.get(tx,'order_request',requestKey);
   if (seen) {
    if (seen.orderId !== id || seen.action !== 'admin_delete' || seen.fingerprint !== fingerprint) this.AppError('请求标识已被使用');
    return {id,deleted:true};
   }
   await store.assertRequestOpen(tx,this.getProjectId(),adminId,REQUEST_ROUTES.admin_delete,input.requestId);
   if (mail.MAIL_ADMIN_DELETED === true) {
    await store.set(tx,'order_request',requestKey,{_pid:this.getProjectId(),orderId:id,action:'admin_delete',fingerprint,createdAt:Date.now()});
    return {id,deleted:true};
   }
   await store.limitInTransaction(tx,this.getProjectId(),adminId,'order_delete',30,60000);
   mail.MAIL_ADMIN_DELETED = true; mail.MAIL_ADMIN_DELETED_AT = Date.now(); mail.MAIL_ADMIN_DELETED_BY = adminId;
   await this._quota(tx,mail.MAIL_USER_ID,'poster',id,false,0);
   if (mail.MAIL_ACCEPT_USER_ID) await this._quota(tx,mail.MAIL_ACCEPT_USER_ID,'rider',id,false,0);
   await this._record(tx,mail,{adminId},'admin_delete',input.requestId,'管理员删除订单',fingerprint);
   return {id,deleted:true};
  });
 }
 async editMail(userId,input) { return this._change(userId,input.id,'edit',input); }
 async statusMail() { this.AppError('已禁用直接修改状态，请使用对应订单操作'); }
 async delMail(userId,id,input) { return this._change(userId,id,'archive',input); }
 async updateMailForms() { this.AppError('请在提交订单前上传图片，并通过编辑订单更新，禁止独立覆盖表单'); }
 async viewMail(userId,id) {
  const mail = await MailModel.getOne(id); if (!mail || mail.MAIL_ADMIN_DELETED === true) return null;
  await new (require('./review_service.js'))().decorateOrders(userId, [mail]);
  const result = rules.project(mail,userId);
  if (result.mypost || result.myaccept) { await this._user(userId, { allowPending: result.mypost && !result.myaccept }); if (mail.MAIL_ACCEPT_USER_ID) result.acceptUser = await UserModel.getOne({USER_MINI_OPENID:mail.MAIL_ACCEPT_USER_ID},'USER_NAME,USER_MOBILE'); }
  if ((result.mypost || result.myaccept) && mail.MAIL_ACCEPT_USER_ID && mail.MAIL_ACCEPT_USER_ID !== mail.MAIL_USER_ID) result.MAIL_FEEDBACK_TARGET = {
   name: result.mypost ? mail.MAIL_ACCEPT_USER_NAME || '接单人' : mail.MAIL_USER_NAME || (mail.MAIL_OBJ || {}).poster || '发布者', role: result.mypost ? '接单人' : '发布者'
  };
  const favorite = (await new (require('./fav_service.js'))().orderStats(userId, [id], [mail])).list[0];
  Object.assign(result, { MAIL_FAV_CNT: favorite.count, MAIL_IS_FAV: favorite.isFav, MAIL_CAN_FAV: favorite.available });
  return media.order(result);
 }
 async getMailDetail(userId,id) {
  const mail = await MailModel.getOne(id); if (!mail || mail.MAIL_ADMIN_DELETED === true) return null;
  if (userId !== null) { await this._user(userId, { allowPending: true }); if (mail.MAIL_USER_ID !== userId) this.AppError('无权限查看该订单'); }
  return media.order(rules.project(mail,userId,userId === null));
 }
 async getMailList(userId,input) {
  let {search,sortType,sortVal,whereEx,page=1,size=20} = input;
  if (!Number.isInteger(page) || page < 1 || page > 500 || !Number.isInteger(size) || size < 1 || size > 50) this.AppError('分页参数无效');
  const where = {and:{_pid:this.getProjectId(),MAIL_ADMIN_DELETED:['<>',true]}};
  const now = Date.now();
  const completedSince = now - 12 * 60 * 60 * 1000;
  if (search === '我的发布') sortType = 'my_post'; if (search === '我的接单') sortType = 'my_accept';
  if (['my_post','my_accept','my_done','status','timeout'].includes(sortType)) {
   await this._user(userId, { allowPending: sortType !== 'my_accept' });
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
    else if (['MAIL_OBJ.address2', 'MAIL_OBJ.address1'].includes(name) && Array.isArray(value) && value.length === 2 && value[0] === 'like' && require('./delivery_address.js').phasesOf(store.scope() && store.scope().campus.locations).includes(value[1])) where.and['MAIL_OBJ.address2'] = ['like', String(value[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')];
    else this.AppError('不允许的筛选条件');
   }
  }
  let order = {MAIL_ADD_TIME:'desc'};
  if (input.orderBy && Object.keys(input.orderBy).length) { if (Object.keys(input.orderBy).length !== 1 || !['MAIL_ADD_TIME','MAIL_OBJ.price'].includes(Object.keys(input.orderBy)[0]) || !['asc','desc'].includes(Object.values(input.orderBy)[0])) this.AppError('排序参数无效'); order = input.orderBy; }
  order = { ...order, _id: 'desc' };
  // Resolve submitted addresses and legacy milestone times before removing
  // private forms and event history from the response below.
  const fields = '_id,_pid,MAIL_ID,MAIL_USER_ID,MAIL_ACCEPT_USER_ID,MAIL_STATUS,MAIL_END_TIME,MAIL_EXPECT_TIME,MAIL_ADD_TIME,MAIL_ACCEPT_TIME,MAIL_PICKUP_TIME,MAIL_OVER_TIME,MAIL_TOTAL_FEE,MAIL_PAYMENT_MODE,MAIL_CATE_ID,MAIL_CATE_NAME,MAIL_DUE_TIME,MAIL_DELIVERED_TIME,MAIL_OBJ,MAIL_FORMS,MAIL_HISTORY,MAIL_VERSION';
  const field = Object.keys(order)[0], direction = order[field];
  const cursor = input.cursor;
  if (cursor && (typeof cursor !== 'object' || cursor.field !== field || cursor.direction !== direction
   || typeof cursor.id !== 'string' || !/^[\w-]{1,128}$/.test(cursor.id) || !Number.isFinite(cursor.value))) this.AppError('订单分页位置无效，请刷新列表');
  const query = cursor ? { and: [where, { or: [
   { [field]: [direction === 'asc' ? '>' : '<', cursor.value] },
   { [field]: cursor.value, _id: ['<', cursor.id] }
  ] }] } : where;
  const countRequired=input.isTotal!==false || !cursor && page>1;
  const [rows, total] = await Promise.all([
   cursor || page === 1 ? MailModel.getAll(JSON.parse(JSON.stringify(query)), fields, order, size + 1)
    : MailModel.getList(JSON.parse(JSON.stringify(query)), fields, order, page, size, false, 0).then(result => result.list),
   countRequired ? MailModel.count(JSON.parse(JSON.stringify(where))) : Promise.resolve(Number(input.oldTotal)||0)
  ]);
  const list = rows.slice(0, size), last = list[list.length - 1];
  const value = last && (field === 'MAIL_ADD_TIME' ? last.MAIL_ADD_TIME : (last.MAIL_OBJ || {}).price);
  const result = { list, page, size, total, totalExact:countRequired, count: Math.ceil(total / size),
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
