'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const rules = require('./order_rules.js');
const media = require('./private_media_service.js');
const Operations = require('./operations_service.js');
class FeedbackService extends Base {
 async insertFeedback(userId,p) {
  const user=await new Mail()._user(userId);new Mail()._request(p.requestId);rules.text(p.title,'反馈标题',60,true);rules.text(p.content,'反馈内容',1000,true);rules.text(p.type,'反馈类型',30,true);rules.images(p.img||[]);
  await store.limit(this.getProjectId(),userId,'feedback',5,3600000);
  const id=store.key(this.getProjectId(),userId,p.requestId);
  await store.transaction(async tx=>{await new Mail()._actor(tx,{userId,user});const old=await store.get(tx,'feedback',id);if(old){if(old.FB_FINGERPRINT!==store.key(p))this.AppError('相同请求标识不能提交不同内容');return;}
   if(p.orderId){const mail=await store.get(tx,'mail',p.orderId);if(!mail||mail._pid!==this.getProjectId()||![mail.MAIL_USER_ID,mail.MAIL_ACCEPT_USER_ID].includes(userId))this.AppError('只能关联本人参与的订单');}
   await store.set(tx,'feedback',id,{_pid:this.getProjectId(),FB_ID:id,FB_FINGERPRINT:store.key(p),FB_USER_ID:userId,FB_USER_NAME:user.USER_NAME,FB_USER_MOBILE:user.USER_MOBILE,FB_TYPE:p.type,FB_TITLE:p.title,FB_CONTENT:p.content,FB_CONTACT:p.contact||'',FB_IMG:p.img||[],FB_ORDER_ID:p.orderId||'',FB_STATUS:0,FB_REPLY:'',FB_REPLY_TIME:0,FB_ADD_TIME:Date.now(),FB_EDIT_TIME:Date.now(),FB_VERSION:0,FB_HISTORY:[]});
  });return {id};
 }
 async getMyFeedbackList(userId,p){await new Mail()._user(userId);const result=await new Operations().list('feedback',{FB_USER_ID:userId},p.page||1,'FB_ADD_TIME');return result;}
 async getMyFeedbackDetail(userId,id){await new Mail()._user(userId);const row=await store.get(store.database(),'feedback',id);if(!row||row._pid!==this.getProjectId()||row.FB_USER_ID!==userId)this.AppError('反馈不存在');return media.feedback(row);}
 async getAdminFeedbackList(p){return new Operations().list('feedback',{},p.page||1,'FB_ADD_TIME');}
 async getAdminFeedbackDetail(id){const row=await store.get(store.database(),'feedback',id);if(!row||row._pid!==this.getProjectId())this.AppError('反馈不存在');return media.feedback(row);}
 async replyFeedback(id,reply,adminId,version,requestId,status=1){
  rules.text(reply,'处理说明',500,true);new Mail()._request(requestId);if(![0,1,2].includes(status))this.AppError('反馈状态无效');
  await store.transaction(async tx=>{await new Mail()._actor(tx,{adminId});const row=await store.get(tx,'feedback',id);if(!row||row._pid!==this.getProjectId())this.AppError('反馈不存在');
   const key=store.key(this.getProjectId(),adminId,requestId);const seen=await store.get(tx,'feedback_request',key);if(seen){if(seen.id!==id || seen.fingerprint!==store.key(reply,version,status))this.AppError('请求标识已被使用');return;}
   if(Number(row.FB_VERSION||0)!==version)this.AppError('反馈已被其他管理员更新，请刷新');
   const now=Date.now(), event={adminId,reply,status,at:now};
   await store.set(tx,'feedback',id,{...row,FB_STATUS:status,FB_REPLY:reply,FB_REPLY_TIME:now,FB_EDIT_TIME:now,FB_VERSION:version+1,FB_HANDLER:adminId,FB_HISTORY:[...(row.FB_HISTORY||[]),event].slice(-100)});
   await store.set(tx,'feedback_request',key,{_pid:this.getProjectId(),id,fingerprint:store.key(reply,version,status),createdAt:now});
   await store.set(tx,'operation_audit',key,{_pid:this.getProjectId(),action:'feedback_reply',feedbackId:id,...event});
   await store.set(tx,'notification',key,{_pid:this.getProjectId(),userId:row.FB_USER_ID,feedbackId:id,title:'投诉反馈有新回复',content:'请查看处理结果',createdAt:now,read:false,delivery:'skipped',attempts:0,nextAttemptAt:0});
  });return {id};
 }
 async statusFeedback(){this.AppError('请附带处理说明后更新反馈');}
 async delFeedback(){this.AppError('反馈及处理凭证不可删除');}
}
module.exports=FeedbackService;
