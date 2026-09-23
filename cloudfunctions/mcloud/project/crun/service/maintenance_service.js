'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
class MaintenanceService extends Base {
 async runScheduled(kind, options = {}) {
  if (!['orders','notifications'].includes(kind)) throw new Error('INVALID_WORKER_KIND');
  const tenant=require('../../../framework/tenancy/tenant_context.js');
  const Tenant=require('./tenant_service.js');
  const batchSize=Math.max(1,Math.min(100,Number(options.batchSize)||50));
  const maxBatches=Math.max(1,Math.min(20,Number(options.maxBatches)||10));
  const deadline=Date.now()+Math.max(1000,Math.min(45000,Number(options.budgetMs)||40000));
  const shard=options.shard;
  if (shard!==undefined && (!Number.isInteger(shard)||shard<0||shard>15)) throw new Error('INVALID_WORKER_SHARD');
  const result={kind,scanned:0,processed:0,failed:0,batches:0,hasMore:false,startedAt:Date.now()};
  const scopes=new Map();
  const runRow=async(row,work)=>{
   const key=row.schoolId+'/'+row.campusId;
   if(!scopes.has(key)){if(scopes.size>=128)scopes.delete(scopes.keys().next().value);scopes.set(key,new Tenant().resolve({schoolId:row.schoolId,campusId:row.campusId},{allowDisabled:true}));}
   const scope=await scopes.get(key);return tenant.run(scope,()=>work(row));
  };
  return tenant.system(async()=>{
   const db=store.database(),cmd=db.command;
   if(kind==='orders')result.accounts=await new (require('./account_service.js'))().sweep({budgetMs:Math.min(8000,Math.max(1,deadline-Date.now()))});
   const stateId=store.key('scheduled',kind,shard===undefined?'all':shard);
   const previous=await store.get(db,'worker_state',stateId);
   const cursors={...(previous&&previous.cursors||{})};
   const finished=new Set();
   for(let batch=0;batch<maxBatches && Date.now()<deadline;batch++){
    const now=Date.now();
    const queries=kind==='notifications'
     ? [['notification',{delivery:cmd.in(['pending','retry','sending']),nextAttemptAt:cmd.lte(now)},'nextAttemptAt']]
     : [['mail',{MAIL_STATUS:0,MAIL_PAYMENT_MODE:'offline',MAIL_END_TIME:cmd.lt(now)},'MAIL_END_TIME'],['mail',cmd.and([{MAIL_STATUS:cmd.in([1,2,3,4]),MAIL_DUE_TIME:cmd.lt(now),MAIL_OVERDUE_NOTIFIED:cmd.neq(true)},{MAIL_DUE_TIME:cmd.gt(0)}]),'MAIL_DUE_TIME']];
    let count=0;
    let more=false;
    for(const [collection,where,order] of queries){
     if(finished.has(order)||Date.now()>=deadline)continue;
     const cursor=cursors[order];
     const filters=[{_pid:'crun',tenantRetired:cmd.neq(true),...(collection==='mail'?{MAIL_ADMIN_DELETED:cmd.neq(true)}:{}),...(shard===undefined?{}:{workerShard:shard})},where];
     if(cursor)filters.push(cmd.or([{[order]:cmd.gt(cursor.time)},{[order]:cursor.time,_id:cmd.gt(cursor.id)}]));
     const rows=await db.collection(store.collection(collection)).where(cmd.and(filters)).orderBy(order,'asc').orderBy('_id','asc').limit(batchSize).get();
     count+=rows.data.length;result.scanned+=rows.data.length;
     const work=await this._scheduledBatch(rows.data,row=>runRow(row,item=>kind==='notifications'?this.dispatch(item._id):this._sweep(item._id,order==='MAIL_END_TIME'?'expire':'overdue')),deadline);
     result.failed+=work.failed;result.processed+=work.started-work.failed;
     const full=rows.data.length===batchSize || work.started<rows.data.length;
     more=more||full;
     // Persist progress past failed rows. Each completed cycle starts again at
     // the oldest due row, so failures are retried without starving later work.
     cursors[order]=full?(work.started?{time:rows.data[work.started-1][order],id:rows.data[work.started-1]._id}:cursor||null):null;
     if(!full)finished.add(order);
    }
    result.batches++;result.hasMore=more || finished.size<queries.length;
    if(!count || !result.hasMore)break;
   }
   result.pruned=0;result.cleanupFailed=0;result.cleanupHasMore=false;
   if(kind==='orders')for(const collection of ['operation_limit','admin_limit']){
    if(Date.now()>=deadline){result.cleanupHasMore=true;break;}
    const rows=(await db.collection(store.collection(collection)).where({_pid:'crun',expiresAt:cmd.lt(Date.now())}).field({_id:true}).orderBy('expiresAt','asc').limit(100).get()).data;
    const cleaned=await this._scheduledBatch(rows,row=>db.collection(store.collection(collection)).doc(row._id).remove(),deadline);
    result.pruned+=cleaned.started-cleaned.failed;result.cleanupFailed+=cleaned.failed;result.cleanupHasMore=result.cleanupHasMore||rows.length===100||cleaned.started<rows.length;
   }
   result.finishedAt=Date.now();result.durationMs=result.finishedAt-result.startedAt;
   // Only scheduling diagnostics are written here; no contact or order payload.
   await store.set(db,'worker_state',stateId,{_pid:'crun',...result,cursors});
   console.info('[worker]',result);
   return result;
  });
 }
 async _scheduledBatch(rows,work,deadline){
  let started=0,failed=0;
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{
   while(started<rows.length&&Date.now()<deadline){const row=rows[started++];try{await work(row);}catch(error){failed++;console.error('[maintenance] item failed',{id:row._id,code:error&&(error.code||error.errCode)||'PROCESS_FAILED'});}}
  }));
  return {started,failed};
 }
 async _sweep(id,action){
  return store.transaction(async tx=>{
   const row=await store.get(tx,'mail',id),now=Date.now();if(!row||row.MAIL_ADMIN_DELETED===true)return;
   const svc=new Mail();row._id=id;
   if(action==='expire'){
    if(row.MAIL_STATUS!==0||row.MAIL_PAYMENT_MODE!=='offline'||row.MAIL_END_TIME>=now)return;
    row.MAIL_STATUS=99;await svc._quota(tx,row.MAIL_USER_ID,'poster',id,false,0);
   }else{
    if(![1,2,3,4].includes(row.MAIL_STATUS)||row.MAIL_OVERDUE_NOTIFIED||!(row.MAIL_DUE_TIME>0&&row.MAIL_DUE_TIME<now))return;
    row.MAIL_OVERDUE_NOTIFIED=true;
   }
   await svc._record(tx,row,{userId:row.MAIL_USER_ID},action,store.key(action,id),action==='expire'?'超过接单截止时间，自动关闭':'订单已超过预计履约时限，请联系对方或提交异常');
  });
 }
 async _batch(rows, work) {
  let cursor=0,failed=0;
  await Promise.all(Array.from({length:Math.min(4,rows.length)},async()=>{
   while(cursor<rows.length){const row=rows[cursor++];try{await work(row);}catch(error){failed++;console.error('[maintenance] item failed',{code:error && (error.code||error.errCode)||'PROCESS_FAILED'});}}
  }));
  return failed;
 }
 async run() {
  const db=store.database(),pid=this.getProjectId(),now=Date.now(),cmd=db.command;
  const expired=await db.collection(store.collection('mail')).where({_pid:pid,MAIL_ADMIN_DELETED:cmd.neq(true),MAIL_STATUS:0,MAIL_PAYMENT_MODE:'offline',MAIL_END_TIME:cmd.lt(now)}).orderBy('MAIL_END_TIME','asc').limit(30).get();
  const expiredFailed=await this._batch(expired.data,item=>store.transaction(async tx=>{const row=await store.get(tx,'mail',item._id);if(!row||row._pid!==pid||row.MAIL_ADMIN_DELETED===true||row.MAIL_STATUS!==0||row.MAIL_END_TIME>=Date.now())return;row._id=item._id;row.MAIL_STATUS=99;const svc=new Mail();await svc._quota(tx,row.MAIL_USER_ID,'poster',row._id,false,0);await svc._record(tx,row,{userId:row.MAIL_USER_ID},'expire',store.key('expire',row._id),'超过接单截止时间，自动关闭');}));
  const overdue=await db.collection(store.collection('mail')).where({_pid:pid,MAIL_ADMIN_DELETED:cmd.neq(true),MAIL_STATUS:cmd.in([1,2,3,4]),MAIL_DUE_TIME:cmd.lt(now),MAIL_OVERDUE_NOTIFIED:cmd.neq(true)}).orderBy('MAIL_DUE_TIME','asc').limit(30).get();
  const overdueFailed=await this._batch(overdue.data,item=>store.transaction(async tx=>{const row=await store.get(tx,'mail',item._id);if(!row||row._pid!==pid||row.MAIL_ADMIN_DELETED===true||![1,2,3,4].includes(row.MAIL_STATUS)||row.MAIL_OVERDUE_NOTIFIED||!(row.MAIL_DUE_TIME>0&&row.MAIL_DUE_TIME<Date.now()))return;row._id=item._id;row.MAIL_OVERDUE_NOTIFIED=true;await new Mail()._record(tx,row,{userId:row.MAIL_USER_ID},'overdue',store.key('overdue',row._id),'订单已超过预计履约时限，请联系对方或提交异常');}));
  const pending=await db.collection(store.collection('notification')).where({_pid:pid,delivery:cmd.in(['pending','retry','sending']),nextAttemptAt:cmd.lte(now)}).orderBy('nextAttemptAt','asc').limit(30).get();
  const notificationFailed=await this._batch(pending.data,message=>this.dispatch(message._id));
  // Only transient rate-limit buckets are pruned. Orders, audit and idempotency records are retained.
  const buckets=await db.collection(store.collection('operation_limit')).where({_pid:pid,expiresAt:cmd.lt(now)}).limit(100).get();
  const cleanupFailed=await this._batch(buckets.data,row=>db.collection(store.collection('operation_limit')).doc(row._id).remove());
  return {expired:expired.data.length-expiredFailed,overdue:overdue.data.length-overdueFailed,notifications:pending.data.length-notificationFailed,cleaned:buckets.data.length-cleanupFailed,failed:expiredFailed+overdueFailed+notificationFailed+cleanupFailed};
 }
 async dispatch(id) {
  const claim=store.key(id,Date.now(),Math.random());
  const row=await store.transaction(async tx=>{const row=await store.get(tx,'notification',id);if(!row||row._pid!==this.getProjectId()||!['pending','retry','sending'].includes(row.delivery)||row.nextAttemptAt>Date.now())return null;
   if((row.attempts||0)>=3){await store.set(tx,'notification',id,{...row,delivery:'failed',error:'RETRY_EXHAUSTED'});return null;}
   const next={...row,delivery:'sending',claim,attempts:(row.attempts||0)+1,nextAttemptAt:Date.now()+300000};await store.set(tx,'notification',id,next);return next;});
  if(!row)return;
  let state='skipped',error='';
  try{
   const subscription=await store.get(store.database(),'subscription',store.scopeKey(this.getProjectId(),row.userId));
   const templateId=process.env.ORDER_SUBSCRIBE_TEMPLATE_ID;
   if(templateId&&subscription&&subscription.enabled&&row.orderId){
    // Template field names must match the template selected in the WeChat console.
    const mapping=JSON.parse(process.env.ORDER_SUBSCRIBE_FIELDS || '{}');
    if(!mapping.order || !mapping.status || !mapping.time)throw new Error('TEMPLATE_FIELDS_NOT_CONFIGURED');
    const values={ [mapping.order]:{value:row.orderId.slice(0,20)},[mapping.status]:{value:row.content.slice(0,20)},[mapping.time]:{value:new Date(row.createdAt+8*3600000).toISOString().slice(0,16).replace('T',' ')} };
    const scope=store.scope();
    const page='projects/crun/pages/mail/my_detail/mail_my_detail?id='+encodeURIComponent(row.orderId)
     +(scope?'&schoolId='+encodeURIComponent(scope.schoolId)+'&campusId='+encodeURIComponent(scope.campusId):'')
     +'&notificationId='+encodeURIComponent(id);
    const result=await cloudBase.getCloud().openapi.subscribeMessage.send({touser:row.userId.split('^^^').pop(),templateId,page,data:values});
    if(result&&result.errCode)throw Object.assign(new Error('SEND_FAILED'),{errCode:result.errCode}); state='sent';
   }
  }catch(e){error=String(e.errCode||e.code||'SEND_FAILED');state=Number(e.errCode)===43101?'skipped':row.attempts>=3?'failed':'retry';}
  await store.transaction(async tx=>{const current=await store.get(tx,'notification',id);if(!current||current.claim!==claim)return;await store.set(tx,'notification',id,{...current,delivery:state,error,nextAttemptAt:Date.now()+60000*Math.pow(2,row.attempts),deliveredAt:state==='sent'?Date.now():0});});
 }
}
module.exports=MaintenanceService;
