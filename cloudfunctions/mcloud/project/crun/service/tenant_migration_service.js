'use strict';
const store=require('./operation_store.js');
const tenant=require('../../../framework/tenancy/tenant_context.js');
const Tenant=require('./tenant_service.js');
const AppError=require('../../../framework/core/app_error.js');
const COLLECTIONS=['mail','user','admin','news','campus_service','campus_service_message','feedback','order_review','order_event','order_request','feedback_request','review_request','notification','news_read','fav','invite','subscription','operation_config','identity_unique','order_quota','order_feed','operation_limit','operation_audit','setup','log'];
const journal=require('./migration_journal.js');
const hash=journal.hash;
const hasScope=row=>tenant.ID.test(row.schoolId||'')&&tenant.ID.test(row.campusId||'');
class TenantMigration {
 _plan(plan){
  if(!plan||plan.version!==1||!tenant.ID.test(plan.legacySchoolId||'')||!plan.aliases||!plan.defaults||!plan.admins)throw new AppError('迁移映射不完整');
  return hash(plan);
 }
 async _scope(collection,row,plan,db,depth=0){
  if(depth>8)throw new AppError('迁移关联循环');
  const explicit=(plan.overrides||{})[collection+'/'+row._id];
  if(explicit)return explicit;
  if(hasScope(row))return {schoolId:row.schoolId,campusId:row.campusId};
  if(['user','identity_unique'].includes(collection))return {schoolId:row.schoolId||plan.legacySchoolId};
  const alias=value=>{
   const text=String(value||'').trim(),short=text.match(/^(.+?校区)(?:[\s·：:-]|$)/);
   return plan.aliases[text] || short && plan.aliases[short[1]];
  };
  if(collection==='mail'){
   const field=(row.MAIL_FORMS||[]).find(x=>x.mark==='campus');
   const value=alias(field&&field.val||row.MAIL_OBJ&&row.MAIL_OBJ.campus);
   if(value)return value;
  }
  if(collection==='campus_service'){const value=alias(row.CS_CAMPUS);if(value)return value;}
  const links={
   campus_service_message:['campus_service',row.CSM_SERVICE_ID],
   order_event:['mail',row.orderId],order_request:['mail',row.orderId],order_review:['mail',row.REVIEW_ORDER_ID],
   feedback:['mail',row.FB_ORDER_ID],feedback_request:['feedback',row.id],review_request:['order_review',row.reviewId],
   notification:row.orderId?['mail',row.orderId]:['feedback',row.feedbackId],
   news_read:['news',row.newsId],fav:[['mail','快递代取'].includes(row.FAV_TYPE)?'mail':'news',row.FAV_OID]
  };
  const link=links[collection];
  if(link&&link[1]){
   const parent=await store.get(db,link[0],link[1]);if(!parent||parent._pid!=='crun')throw new AppError('迁移关联记录不存在');
   return this._scope(link[0],{...parent,_id:link[1]},plan,db,depth+1);
  }
  if(plan.defaults[collection])return plan.defaults[collection];
  throw new AppError('无法确定历史记录所属校区，请添加明确映射');
 }
 async _targets(collection,row,plan,planHash,db){
  if(row._tenantMigration===planHash)return [];
  // Fresh scoped rows and records migrated by another plan are never retired
  // or reassigned just because a legacy scan encounters them.
  if(hasScope(row)||['user','identity_unique'].includes(collection)&&tenant.ID.test(row.schoolId||'')||collection==='admin'&&typeof row.ADMIN_PLATFORM==='boolean'&&Array.isArray(row.ADMIN_SCOPES))return [];
  if(collection!=='admin'&&(row.schoolId||row.campusId))throw new AppError('历史记录只有部分范围字段，请先人工核对');
  const tag={_tenantMigration:planHash};
  if(collection==='admin'){
   const grant=plan.admins[row._id];if(!grant)throw new AppError('管理员缺少明确授权映射');
   if(grant.platform!==true && !Array.isArray(grant.scopes))throw new AppError('管理员授权格式无效');
   if(grant.platform===true&&row.ADMIN_TYPE!==1)throw new AppError('仅现有超级管理员可迁为平台管理员');
   for(const scope of grant.scopes||[]){if(scope.campusId==='*'){if(!await store.get(db,'school',scope.schoolId))throw new AppError('授权学校不存在');}else await new Tenant().resolve(scope,{allowDisabled:true});}
   return [{collection,id:row._id,value:{...row,...tag,ADMIN_PLATFORM:grant.platform===true,ADMIN_SCOPES:grant.platform?[]:grant.scopes,ADMIN_TOKEN:'',ADMIN_TOKEN_USER:'',ADMIN_TOKEN_TIME:0}}];
  }
  if(['order_feed','operation_limit','order_quota','identity_unique'].includes(collection)){
   // Derived legacy keys are retained as retired records. Quotas are seeded
   // from active orders on first use; uniqueness locks are rebuilt from users.
   return [{collection,id:row._id,value:{...row,...tag,tenantRetired:true}}];
  }
  const selected=collection==='operation_config' ? plan.configTargets : [await this._scope(collection,row,plan,db)];
  if(!Array.isArray(selected)||!selected.length)throw new AppError('必须明确配置迁移目标');
  const targets=[];
  for(const selection of selected){
   let scope;
   if(collection==='user'){
    if(!await store.get(db,'school',selection.schoolId))throw new AppError('学校不存在');
    scope={schoolId:selection.schoolId};
   }else scope=await new Tenant().resolve(selection,{allowDisabled:true});
   const fields={schoolId:scope.schoolId,...(collection==='user'?{}:{campusId:scope.campusId})};
   let id=row._id,value={...row,...fields,...tag};
   if(collection==='operation_config'){
    id=store.key('crun','config',scope.schoolId,scope.campusId);
    value={...value,value:{...row.value,campuses:[scope.campusName],enabled:false},version:1};
   }
   if(collection==='subscription')id=store.key('crun',row.userId,scope.schoolId,scope.campusId);
   if(['mail','notification'].includes(collection))value.workerShard=parseInt(store.key(id).slice(0,8),16)%16;
   if(collection==='mail'){
    value.MAIL_SCHEMA_VERSION=value.MAIL_SCHEMA_VERSION||1;
    value.MAIL_RULE_SNAPSHOT=value.MAIL_RULE_SNAPSHOT||{legacy:true,totalFee:value.MAIL_TOTAL_FEE,paymentMode:value.MAIL_PAYMENT_MODE||'legacy',deliveryMinutes:value.MAIL_DELIVERY_MINUTES||null};
   }
   targets.push({collection,id,value:{...value,_id:id}});
   if(collection==='user'&&row.USER_MOBILE){
    targets.push({collection:'identity_unique',id:store.key('crun','phone',row.USER_MOBILE,scope.schoolId),value:{_pid:'crun',schoolId:scope.schoolId,userId:row.USER_MINI_OPENID,...tag}});
   }
   if(collection==='invite'&&row.INV_CODE)targets.push({collection:'identity_unique',id:store.key('crun','invite-code',row.INV_CODE,scope.schoolId),value:{_pid:'crun',schoolId:scope.schoolId,userId:row.INV_USER_ID,code:row.INV_CODE,...tag}});
   if(['mail','order_request','feedback','feedback_request','review_request'].includes(collection)){
    targets.push({collection:'request_scope',id:row._id,value:{_pid:'crun',...fields,...tag}});
   }
   if(collection==='order_review'&&row.REVIEW_FROM_USER_ID&&row.REVIEW_REQUEST_ID)targets.push({collection:'request_scope',id:store.key('crun',row.REVIEW_FROM_USER_ID,row.REVIEW_REQUEST_ID),value:{_pid:'crun',...fields,...tag}});
  }
  if(!targets.some(x=>x.collection===collection&&x.id===row._id))targets.push({collection,id:row._id,value:{...row,...tag,tenantRetired:true}});
  return targets;
 }
 async batch({collection,after='',size=20,plan,dryRun=true,expectedHash}){
  return tenant.system(async()=>{
   const planHash=this._plan(plan);if(!COLLECTIONS.includes(collection)||typeof after!=='string'||!Number.isInteger(size)||size<1||size>100)throw new AppError('迁移批次参数无效');
   const db=store.database(),rows=(await db.collection(store.collection(collection)).where({_pid:'crun',...(after?{_id:db.command.gt(after)}:{})}).orderBy('_id','asc').limit(size).get()).data;
   const built=[],items=[],plannedTargets=new Map();
   for(const row of rows){
    try {const targets=await this._targets(collection,row,plan,planHash,db);
     for(const target of targets){const old=await store.get(db,target.collection,target.id);journal.check(old,target,row._id);target.beforeHash=hash(old);target.value={...target.value,_id:target.id};const key=target.collection+'/'+target.id;if(plannedTargets.has(key)&&hash(plannedTargets.get(key))!==hash(target.value))journal.check(plannedTargets.get(key),target,'');plannedTargets.set(key,target.value);}
     built.push({row,targets});
     items.push({id:row._id,beforeHash:hash(row),status:targets.length?'ready':'already',targets:targets.map(x=>({collection:x.collection,id:x.id,beforeHash:x.beforeHash,hash:hash(x.value)}))});
    }catch(error){items.push({id:row._id,status:'unresolved',reason:error.message});}
   }
   const batchHash=hash([planHash,collection,after,size,items]);
   const result={planHash,batchHash,collection,after,items,nextAfter:rows.length?rows[rows.length-1]._id:after,hasMore:rows.length===size,dryRun};
   if(dryRun)return result;
   if(expectedHash!==batchHash)throw new AppError('迁移数据或映射已变化，请重新预检并使用新的批次指纹');
   if(items.some(x=>x.status==='unresolved'))throw new AppError('存在无法确定归属的记录，不能执行此批次');
   const checkpointId=store.key(planHash,'checkpoint',collection);
   const checkpoint=await store.get(db,'tenant_migration',checkpointId);
   if(after && (!checkpoint||checkpoint.after!==after))throw new AppError('迁移批次不连续，请从已保存的检查点继续');
   for(const {row,targets} of built){
    if(!targets.length)continue;
    await store.transaction(async tx=>{
     const current=await store.get(tx,collection,row._id);if(hash(current)!==hash(row))throw new AppError('迁移期间记录发生变化，已停止；请暂停旧版本写入后重新预检');
     for(const target of targets)await journal.commit(tx,planHash,target,row._id);
    });
   }
   await store.set(db,'tenant_migration',checkpointId,{_pid:'crun',planHash,kind:'checkpoint',collection,after:result.nextAfter,complete:!result.hasMore,updatedAt:Date.now()});
   return {...result,applied:items.filter(x=>x.status==='ready').length};
  });
 }
 async rollback({plan,after='',size=20}){
  return tenant.system(async()=>{
   const planHash=this._plan(plan),db=store.database();
   if(!Number.isInteger(size)||size<1||size>100)throw new AppError('回滚批次无效');
   const rows=(await db.collection(store.collection('tenant_migration')).where({_pid:'crun',planHash,kind:'record',status:'applied',...(after?{_id:db.command.gt(after)}:{})}).orderBy('_id','asc').limit(size).get()).data;
   for(const item of rows)await store.transaction(async tx=>{
    const backup=await store.get(tx,'tenant_migration',item._id);if(!backup||backup.status!=='applied')return;
    const current=await store.get(tx,backup.collection,backup.targetId);if(hash(current)!==backup.afterHash)throw new AppError('迁移后已有业务写入，拒绝覆盖；请导出差异后人工回滚');
    // Restore with the raw scoped-bypass database, without enriching legacy
    // records with today's worker fields.
    if(backup.before){const data={...backup.before};delete data._id;await tx.collection(store.collection(backup.collection)).doc(backup.targetId).set({data});}
    else await tx.collection(store.collection(backup.collection)).doc(backup.targetId).remove();
    await store.set(tx,'tenant_migration',item._id,{...backup,status:'rolled_back',rolledBackAt:Date.now()});
   });
   return {rolledBack:rows.length,nextAfter:rows.length?rows[rows.length-1]._id:after,hasMore:rows.length===size};
  });
 }
 async verify(options){return new (require('./tenant_migration_verify.js'))(this).batch(options);}
 async finalize(options){return new (require('./tenant_migration_verify.js'))(this).finalize(options);}
}
TenantMigration.COLLECTIONS=COLLECTIONS;
module.exports=TenantMigration;
