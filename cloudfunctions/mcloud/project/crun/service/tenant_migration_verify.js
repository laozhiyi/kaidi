'use strict';
const store = require('./operation_store.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const Tenant = require('./tenant_service.js');
const Catalog = require('./news_catalog_service.js');
const journal = require('./migration_journal.js');
const AppError = require('../../../framework/core/app_error.js');
const same = (a,b) => a.schoolId===b.schoolId && a.campusId===b.campusId;
class MigrationVerify {
  constructor(migration) { this.migration=migration; this.directory=new Tenant(); this.counts=new Map(); }
  async check(collection,row,db) {
    if (row.tenantRetired) {
      if (row.schoolId || row.campusId) throw new AppError('已退役记录仍有有效范围');
      return;
    }
    if (collection==='admin') {
      if (row.ADMIN_PLATFORM===true && row.ADMIN_TYPE===1) return;
      if (!Array.isArray(row.ADMIN_SCOPES) || row.ADMIN_STATUS===1 && !row.ADMIN_SCOPES.length) throw new AppError('管理员尚未明确授权或停用');
      for(const grant of row.ADMIN_SCOPES) {
        if(grant.campusId==='*') { if(!await store.get(db,'school',grant.schoolId))throw new AppError('管理员学校授权无效'); }
        else await this.directory.resolve(grant,{allowDisabled:true});
      }
      return;
    }
    if (['user','identity_unique'].includes(collection)) {
      const school=await store.get(db,'school',row.schoolId);
      if(!school || school._pid!=='crun' || row.campusId)throw new AppError('账号学校范围无效');
      if(collection==='user') {
        if(!row.USER_MINI_OPENID)throw new AppError('账号缺少微信身份');
        const users=db.collection(store.collection('user'));
        if((await users.where({_pid:'crun',schoolId:row.schoolId,USER_MINI_OPENID:row.USER_MINI_OPENID}).count()).total!==1)throw new AppError('同一学校存在重复账号，请人工合并');
        if(row.USER_MOBILE) {
          const lock=await store.get(db,'identity_unique',store.key('crun','phone',row.USER_MOBILE,row.schoolId));
          if(!lock || lock.userId!==row.USER_MINI_OPENID)throw new AppError('账号手机号唯一键缺失或冲突');
        }
      }
      return;
    }
    const scope=await this.directory.resolve(row,{allowDisabled:true});
    if(['mail','notification'].includes(collection) && row.workerShard!==parseInt(store.key(row._id).slice(0,8),16)%16)throw new AppError('定时任务分片缺失或不匹配');
    const links={campus_service_message:['campus_service',row.CSM_SERVICE_ID],order_event:['mail',row.orderId],order_request:['mail',row.orderId],order_review:['mail',row.REVIEW_ORDER_ID],feedback:['mail',row.FB_ORDER_ID],feedback_request:['feedback',row.id],review_request:['order_review',row.reviewId],news_read:['news',row.newsId],notification:row.orderId?['mail',row.orderId]:['feedback',row.feedbackId],fav:[['mail','快递代取'].includes(row.FAV_TYPE)?'mail':'news',row.FAV_OID]};
    const link=links[collection];
    if(link && link[1]) { const parent=await store.get(db,link[0],link[1]); if(!parent || parent._pid!=='crun' || !same(parent,scope))throw new AppError('关联记录缺失或跨校区'); }
    const guards=['mail','order_request','feedback','feedback_request','review_request'].includes(collection)?[row._id]:[];
    if(collection==='order_review'&&row.REVIEW_FROM_USER_ID&&row.REVIEW_REQUEST_ID)guards.push(store.key('crun',row.REVIEW_FROM_USER_ID,row.REVIEW_REQUEST_ID));
    for(const id of guards) { const guard=await store.get(db,'request_scope',id); if(!guard || guard._pid!=='crun' || !same(guard,scope))throw new AppError('请求归属保护缺失或跨校区'); }
    if(collection==='operation_config' && row._id!==store.key('crun','config',scope.schoolId,scope.campusId))throw new AppError('校区配置键无效');
    if(collection==='subscription' && row._id!==store.key('crun',row.userId,scope.schoolId,scope.campusId))throw new AppError('订阅设置键无效');
    if(collection==='mail') {
      if(!row.MAIL_SCHEMA_VERSION || !row.MAIL_RULE_SNAPSHOT)throw new AppError('订单缺少历史规则快照');
      for(const [field,states] of [['MAIL_USER_ID',[0,1,2,3,4]],['MAIL_ACCEPT_USER_ID',[1,2,3,4]]]) {
        if(!row[field] || !states.includes(row.MAIL_STATUS))continue;
        const key=store.key(scope.schoolId,scope.campusId,field,row[field]);
        if(!this.counts.has(key))this.counts.set(key,await db.collection(store.collection('mail')).where({_pid:'crun',schoolId:scope.schoolId,campusId:scope.campusId,[field]:row[field],MAIL_STATUS:db.command.in(states),MAIL_ADMIN_DELETED:db.command.neq(true)}).count());
        if(this.counts.get(key).total>=1000)throw new AppError('历史在途订单达到1000条，需先人工核对配额');
      }
    }
    if(collection==='news' && row.NEWS_STATUS===1 && (!Array.isArray(row.NEWS_CONTENT)||!row.NEWS_CONTENT.length))throw new AppError('有效公告缺少正文，请补全或撤下');
  }
  async batch({collection,after='',size=20,plan}) {
    return tenant.system(async()=>{
      const planHash=this.migration._plan(plan), db=store.database();
      if(!this.migration.constructor.COLLECTIONS.includes(collection)||!Number.isInteger(size)||size<1||size>100||typeof after!=='string')throw new AppError('核验批次无效');
      const applied=await store.get(db,'tenant_migration',store.key(planHash,'checkpoint',collection));
      if(!applied||!applied.complete)throw new AppError('请先完成该集合全部迁移批次');
      const key=store.key(planHash,'verified',collection), previous=await store.get(db,'tenant_migration',key);
      if(after && (!previous || previous.after!==after || previous.appliedAt!==applied.updatedAt))throw new AppError('核验批次不连续或迁移已变化，请从头核验');
      const rows=(await db.collection(store.collection(collection)).where({_pid:'crun',...(after?{_id:db.command.gt(after)}:{})}).orderBy('_id','asc').limit(size).get()).data;
      const issues=[];
      for(const row of rows)try{await this.check(collection,row,db);}catch(error){issues.push({id:row._id,reason:error.message});}
      const nextAfter=rows.length?rows[rows.length-1]._id:after, hasMore=rows.length===size;
      const result={collection,checked:rows.length,issues,nextAfter,hasMore};
      if(!issues.length)await store.set(db,'tenant_migration',key,{_pid:'crun',planHash,kind:'verified',collection,after:nextAfter,complete:!hasMore,appliedAt:applied.updatedAt,updatedAt:Date.now(),checked:(after&&previous?previous.checked:0)+rows.length});
      return result;
    });
  }
  async finalize({plan,scope}) {
    return tenant.system(async()=>{
      const planHash=this.migration._plan(plan),db=store.database();
      for(const collection of this.migration.constructor.COLLECTIONS) {
        const applied=await store.get(db,'tenant_migration',store.key(planHash,'checkpoint',collection));
        const verified=await store.get(db,'tenant_migration',store.key(planHash,'verified',collection));
        if(!applied||!applied.complete||!verified||!verified.complete||verified.appliedAt!==applied.updatedAt)throw new AppError('集合尚未迁移并核验完成：'+collection);
      }
      if((await db.collection(store.collection('tenant_migration')).where({_pid:'crun',planHash,status:'rolled_back'}).count()).total)throw new AppError('迁移已经回滚，不能完成发布准备');
      if(!(await db.collection(store.collection('admin')).where({_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1,ADMIN_PLATFORM:true}).count()).total)throw new AppError('缺少有效的平台管理员');
      const selected=await this.directory.resolve(scope,{allowDisabled:true});
      return tenant.run(selected,async()=>{
        if((await new (require('./operation_config_service.js'))().getConfig()).enabled)throw new AppError('发布准备期间请先暂停该校区服务');
        const entries=await new Catalog().entries();
        const id=Catalog.manifestId(),old=await store.get(db,'news_manifest',id);
        const value={_pid:'crun',schoolId:selected.schoolId,campusId:selected.campusId,entries,version:journal.hash([planHash,selected.schoolId,selected.campusId,entries]),updatedAt:Date.now(),_tenantMigration:planHash};
        // Journal metadata uses the system scope, while the rebuild read above
        // uses the target campus. No early empty manifest survives migration.
        if(!old || old._tenantMigration!==planHash || old.version!==value.version)await tenant.system(()=>store.transaction(tx=>journal.commit(tx,planHash,{collection:'news_manifest',id,value,beforeHash:journal.hash(old)},id)));
        return {schoolId:selected.schoolId,campusId:selected.campusId,activeNews:entries.length,ready:true,enabled:false};
      });
    });
  }
}
module.exports=MigrationVerify;
