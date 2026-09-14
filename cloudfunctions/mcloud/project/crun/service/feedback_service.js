'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const rules = require('./order_rules.js');
const media = require('./private_media_service.js');
const Operations = require('./operations_service.js');
const reputation = require('./reputation_rules.js');
class FeedbackService extends Base {
 sourceFingerprint(p) {
  return store.key(p.type, p.title, p.content, p.contact || '', p.img || [], p.orderId || '');
 }
 async submittedFeedback(userId, p) {
  await new Mail()._user(userId);
  new Mail()._request(p.requestId);
  const id = store.key(this.getProjectId(), userId, p.requestId);
  const old = await store.get(store.database(), 'feedback', id);
  if (!old) return null;
  if (old.FB_SOURCE_FINGERPRINT) {
   if (old.FB_SOURCE_FINGERPRINT !== this.sourceFingerprint(p)) this.AppError('相同请求标识不能提交不同内容');
   return { id };
  }
  // 旧记录需要先归档图片，再按原有指纹核对。
  return old.FB_FINGERPRINT === store.key(p) ? { id } : null;
 }
 async _ratingTarget(tx, row) {
  if (row.FB_TYPE !== 'complain' || !row.FB_ORDER_ID) return null;
  // New feedback binds its target at submission, including an explicitly empty
  // target. A rider who accepts later must never inherit an earlier complaint.
  if (Object.prototype.hasOwnProperty.call(row, 'FB_TARGET_USER_ID') && !row.FB_TARGET_USER_ID) return null;
  const mail = await store.get(tx, 'mail', row.FB_ORDER_ID);
  if (!mail || mail._pid !== this.getProjectId() || ![mail.MAIL_USER_ID, mail.MAIL_ACCEPT_USER_ID].includes(row.FB_USER_ID)) return null;
  if (!row.FB_TARGET_USER_ID && row.FB_ADD_TIME && mail.MAIL_ACCEPT_TIME && row.FB_ADD_TIME < mail.MAIL_ACCEPT_TIME) return null;
  const poster = mail.MAIL_USER_ID === row.FB_USER_ID, userId = poster ? mail.MAIL_ACCEPT_USER_ID : mail.MAIL_USER_ID;
  if (!userId || userId === row.FB_USER_ID || row.FB_TARGET_USER_ID && row.FB_TARGET_USER_ID !== userId) return null;
  return { userId, name: poster ? mail.MAIL_ACCEPT_USER_NAME || '接单人' : mail.MAIL_USER_NAME || (mail.MAIL_OBJ || {}).poster || '发布者', role: poster ? '接单人' : '发布者' };
 }
 async insertFeedback(userId,p,sourceFingerprint = this.sourceFingerprint(p)) {
  const user=await new Mail()._user(userId);new Mail()._request(p.requestId);rules.text(p.title,'反馈标题',60,true);rules.text(p.content,'反馈内容',1000,true);rules.text(p.type,'反馈类型',30,true);rules.images(p.img||[]);
  const id=store.key(this.getProjectId(),userId,p.requestId);
  await store.transaction(async tx=>{const actor=await new Mail()._actor(tx,{userId,user});const old=await store.get(tx,'feedback',id);if(old){if(old.FB_SOURCE_FINGERPRINT ? old.FB_SOURCE_FINGERPRINT!==sourceFingerprint : old.FB_FINGERPRINT!==store.key(p))this.AppError('相同请求标识不能提交不同内容');return;}
   await store.assertRequestOpen(tx,this.getProjectId(),userId,'feedback/insert',p.requestId);
   if(p.orderId){const mail=await store.get(tx,'mail',p.orderId);if(!mail||mail._pid!==this.getProjectId()||![mail.MAIL_USER_ID,mail.MAIL_ACCEPT_USER_ID].includes(userId))this.AppError('只能关联本人参与的订单');}
   const target = await this._ratingTarget(tx, { FB_TYPE: p.type, FB_ORDER_ID: p.orderId, FB_USER_ID: userId });
   // 与新申诉一起提交；重试和失败事务不消耗次数，不同用户不共用写锁。
   await store.limitInTransaction(tx,this.getProjectId(),userId,'feedback',5,3600000);
   await store.set(tx,'feedback',id,{_pid:this.getProjectId(),FB_ID:id,FB_FINGERPRINT:store.key(p),FB_SOURCE_FINGERPRINT:sourceFingerprint,FB_USER_ID:userId,FB_USER_NAME:actor.USER_NAME,FB_USER_MOBILE:actor.USER_MOBILE,FB_TYPE:p.type,FB_TITLE:p.title,FB_CONTENT:p.content,FB_CONTACT:p.contact||'',FB_IMG:p.img||[],FB_ORDER_ID:p.orderId||'',FB_STATUS:0,FB_REPLY:'',FB_REPLY_TIME:0,FB_ADD_TIME:Date.now(),FB_EDIT_TIME:Date.now(),FB_VERSION:0,FB_HISTORY:[],
    FB_TARGET_USER_ID: target ? target.userId : '', FB_TARGET_NAME: target ? target.name : '', FB_TARGET_ROLE: target ? target.role : '', FB_REVIEW_SCORE: 0});
  });return {id};
 }
 async getMyFeedbackList(userId,p){await new Mail()._user(userId);const result=await new Operations().list('feedback',{FB_USER_ID:userId},p.page||1,'FB_ADD_TIME');return result;}
 async getMyFeedbackDetail(userId,id){await new Mail()._user(userId);const row=await store.get(store.database(),'feedback',id);if(!row||row._pid!==this.getProjectId()||row.FB_USER_ID!==userId)this.AppError('反馈不存在');return media.feedback(row);}
 async getAdminFeedbackList(p) {
  const where = {};
  if (p.status !== undefined && p.status !== -1) {
   if (![0, 1, 2].includes(p.status)) this.AppError('反馈状态无效');
   where.FB_STATUS = p.status;
  }
  if (p.type) where.FB_TYPE = rules.text(p.type, '反馈类型', 30, true);
  return new Operations().list('feedback', where, p.page || 1, 'FB_ADD_TIME', 20, { search: p.search, searchFields: ['FB_TITLE', 'FB_CONTENT', 'FB_USER_NAME'] });
 }
 async getAdminFeedbackDetail(id){
  const row=await store.get(store.database(),'feedback',id);if(!row||row._pid!==this.getProjectId())this.AppError('反馈不存在');
  const target = await this._ratingTarget(store.database(), row);
  return media.feedback({ ...row, FB_CAN_RATE: !!target, FB_TARGET_NAME: target ? target.name : row.FB_TARGET_NAME || '', FB_TARGET_ROLE: target ? target.role : row.FB_TARGET_ROLE || '' });
 }
 async replyFeedback(id,reply,adminId,version,requestId,status=1,rating={}){
  rules.text(reply,'处理说明',500,true);new Mail()._request(requestId);if(![0,1,2].includes(status))this.AppError('反馈状态无效');
  if (!Number.isInteger(version) || version < 0) this.AppError('反馈版本无效，请刷新');
  const action = rating.ratingAction || 'keep', score = rating.reviewScore;
  if (!['keep', 'rate', 'clear'].includes(action)) this.AppError('评分处理方式无效');
  if (action === 'rate' && (status !== 1 || !Number.isInteger(score) || score < 1 || score > 5)) this.AppError('审核处理完成后才可给出1至5星评分');
  if (action !== 'rate' && score !== undefined) this.AppError('请明确选择审核评分');
  const fingerprint = store.key(reply,version,status,action,score === undefined ? null : score);
  await store.transaction(async tx=>{await new Mail()._actor(tx,{adminId});const row=await store.get(tx,'feedback',id);if(!row||row._pid!==this.getProjectId())this.AppError('反馈不存在');
   const key=store.key(this.getProjectId(),adminId,requestId);const seen=await store.get(tx,'feedback_request',key);if(seen){if(seen.id!==id || !(seen.fingerprint===fingerprint || action==='keep' && seen.fingerprint===store.key(reply,version,status)))this.AppError('请求标识已被使用');return;}
   await store.assertRequestOpen(tx,this.getProjectId(),adminId,'admin/feedback_reply',requestId);
   if(Number(row.FB_VERSION||0)!==version)this.AppError('反馈已被其他管理员更新，请刷新');
   const now=Date.now(), target=await this._ratingTarget(tx,row);
   if (action === 'rate' && !target) this.AppError('只有关联真实订单对方的申诉才可评分');
   const oldScore = row.FB_STATUS === 1 ? Number(row.FB_REVIEW_SCORE || 0) : 0;
   const nextScore = status !== 1 || action === 'clear' ? 0 : action === 'rate' ? score : Number(row.FB_REVIEW_SCORE || 0);
   if (nextScore && !target) this.AppError('无法核实被申诉用户，请先撤销评分');
   const patch = action === 'rate' ? { FB_TARGET_USER_ID: target.userId, FB_TARGET_NAME: target.name, FB_TARGET_ROLE: target.role,
    FB_REVIEW_SCORE: score, FB_REVIEW_POINTS: reputation.points(score), FB_REVIEW_TIME: now, FB_REVIEW_ADMIN_ID: adminId, FB_REVIEW_REASON: reply }
    : nextScore ? {} : { FB_REVIEW_SCORE: 0, FB_REVIEW_POINTS: 0, FB_REVIEW_TIME: 0, FB_REVIEW_REASON: '' };
   const event={adminId,reply,status,at:now,ratingAction:action,previousScore:oldScore,reviewScore:nextScore,
    reviewPoints:nextScore ? reputation.points(nextScore) : 0,targetName:target ? target.name : row.FB_TARGET_NAME || ''};
   await store.set(tx,'feedback',id,{...row,...patch,FB_STATUS:status,FB_REPLY:reply,FB_REPLY_TIME:now,FB_EDIT_TIME:now,FB_VERSION:version+1,FB_HANDLER:adminId,FB_HISTORY:[...(row.FB_HISTORY||[]),event].slice(-100)});
   await store.set(tx,'feedback_request',key,{_pid:this.getProjectId(),id,fingerprint,createdAt:now});
   await store.set(tx,'operation_audit',key,{_pid:this.getProjectId(),action:'feedback_reply',feedbackId:id,...event});
   await store.set(tx,'notification',key,{_pid:this.getProjectId(),userId:row.FB_USER_ID,feedbackId:id,title:'投诉反馈有新回复',content:'请查看处理结果',createdAt:now,read:false,delivery:'skipped',attempts:0,nextAttemptAt:0});
   const targetId = target ? target.userId : row.FB_TARGET_USER_ID;
   if (targetId && oldScore !== nextScore) await store.set(tx,'notification',store.key(key,'reputation'),{_pid:this.getProjectId(),userId:targetId,reputation:true,title:'信誉分审核结果更新',content:nextScore ? '管理员已完成申诉审核，请查看星级与计分记录。' : '此前的申诉评分已撤销，请查看最新信誉分。',createdAt:now,read:false,delivery:'skipped',attempts:0,nextAttemptAt:0});
  });return {id};
 }
 async statusFeedback(){this.AppError('请附带处理说明后更新反馈');}
 async delFeedback(){this.AppError('反馈及处理凭证不可删除');}
}
module.exports=FeedbackService;
