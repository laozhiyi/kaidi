'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
class MaintenanceService extends Base {
 async run() {
  const db=store.database(),pid=this.getProjectId(),now=Date.now(),cmd=db.command;
  const expired=await db.collection(store.collection('mail')).where({_pid:pid,MAIL_STATUS:0,MAIL_PAYMENT_MODE:'offline',MAIL_END_TIME:cmd.lt(now)}).orderBy('MAIL_END_TIME','asc').limit(30).get();
  for(const item of expired.data)await store.transaction(async tx=>{const row=await store.get(tx,'mail',item._id);if(!row||row.MAIL_STATUS!==0||row.MAIL_END_TIME>=Date.now())return;row._id=item._id;row.MAIL_STATUS=99;const svc=new Mail();await svc._quota(tx,row.MAIL_USER_ID,'poster',row._id,false,0);await svc._record(tx,row,{userId:row.MAIL_USER_ID},'expire',store.key('expire',row._id),'超过接单截止时间，自动关闭');});
  const overdue=await db.collection(store.collection('mail')).where({_pid:pid,MAIL_STATUS:cmd.in([1,2,3]),MAIL_DUE_TIME:cmd.lt(now),MAIL_OVERDUE_NOTIFIED:cmd.neq(true)}).orderBy('MAIL_DUE_TIME','asc').limit(30).get();
  for(const item of overdue.data)await store.transaction(async tx=>{const row=await store.get(tx,'mail',item._id);if(!row||![1,2,3].includes(row.MAIL_STATUS)||row.MAIL_OVERDUE_NOTIFIED)return;row._id=item._id;row.MAIL_OVERDUE_NOTIFIED=true;await new Mail()._record(tx,row,{userId:row.MAIL_USER_ID},'overdue',store.key('overdue',row._id),'订单已超过预计履约时限，请联系对方或提交异常');});
  const pending=await db.collection(store.collection('notification')).where({_pid:pid,delivery:cmd.in(['pending','retry','sending']),nextAttemptAt:cmd.lte(now)}).orderBy('nextAttemptAt','asc').limit(30).get();
  for(const message of pending.data)await this.dispatch(message._id);
  // Only transient rate-limit buckets are pruned. Orders, audit and idempotency records are retained.
  const buckets=await db.collection(store.collection('operation_limit')).where({_pid:pid,expiresAt:cmd.lt(now)}).limit(100).get();
  for(const row of buckets.data)await db.collection(store.collection('operation_limit')).doc(row._id).remove();
  return {expired:expired.data.length,overdue:overdue.data.length,notifications:pending.data.length,cleaned:buckets.data.length};
 }
 async dispatch(id) {
  const claim=store.key(id,Date.now(),Math.random());
  const row=await store.transaction(async tx=>{const row=await store.get(tx,'notification',id);if(!row||row._pid!==this.getProjectId()||!['pending','retry','sending'].includes(row.delivery)||row.nextAttemptAt>Date.now())return null;
   if((row.attempts||0)>=3){await store.set(tx,'notification',id,{...row,delivery:'failed',error:'RETRY_EXHAUSTED'});return null;}
   const next={...row,delivery:'sending',claim,attempts:(row.attempts||0)+1,nextAttemptAt:Date.now()+300000};await store.set(tx,'notification',id,next);return next;});
  if(!row)return;
  let state='skipped',error='';
  try{
   const subscription=await store.get(store.database(),'subscription',store.key(this.getProjectId(),row.userId));
   const templateId=process.env.ORDER_SUBSCRIBE_TEMPLATE_ID;
   if(templateId&&subscription&&subscription.enabled&&row.orderId){
    // Template field names must match the template selected in the WeChat console.
    const mapping=JSON.parse(process.env.ORDER_SUBSCRIBE_FIELDS || '{}');
    if(!mapping.order || !mapping.status || !mapping.time)throw new Error('TEMPLATE_FIELDS_NOT_CONFIGURED');
    const values={ [mapping.order]:{value:row.orderId.slice(0,20)},[mapping.status]:{value:row.content.slice(0,20)},[mapping.time]:{value:new Date(row.createdAt+8*3600000).toISOString().slice(0,16).replace('T',' ')} };
    const result=await cloudBase.getCloud().openapi.subscribeMessage.send({touser:row.userId.split('^^^').pop(),templateId,page:'projects/crun/pages/mail/my_detail/mail_my_detail?id='+row.orderId,data:values});
    if(result&&result.errCode)throw Object.assign(new Error('SEND_FAILED'),{errCode:result.errCode}); state='sent';
   }
  }catch(e){error=String(e.errCode||e.code||'SEND_FAILED');state=Number(e.errCode)===43101?'skipped':row.attempts>=3?'failed':'retry';}
  await store.transaction(async tx=>{const current=await store.get(tx,'notification',id);if(!current||current.claim!==claim)return;await store.set(tx,'notification',id,{...current,delivery:state,error,nextAttemptAt:Date.now()+60000*Math.pow(2,row.attempts),deliveredAt:state==='sent'?Date.now():0});});
 }
}
module.exports=MaintenanceService;
