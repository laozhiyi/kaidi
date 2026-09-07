'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const Config = require('./operation_config_service.js');
const rules = require('./order_rules.js');
const User = require('../model/user_model.js');
class OperationsService extends Base {
 async config(userId) { return {...await new Config().getConfig(),templateId:process.env.ORDER_SUBSCRIBE_TEMPLATE_ID || '',uploadPrefix:'private/'+userId.split('^^^').pop()+'/'}; }
 async riderApply(userId, campus) {
  const user=await new Mail()._user(userId), config=await new Config().getConfig();
  if(!config.campuses.includes(campus))this.AppError('校区无效');
  await store.limit(this.getProjectId(),userId,'rider_apply',3,86400000);
  await store.transaction(async tx=>{const current=await store.get(tx,'user',user._id);if(current.USER_STATUS!==1)this.AppError('用户状态已改变');if(current.USER_RIDER_STATUS===1)this.AppError('已取得资格，变更校区请联系管理员');if(current.USER_RIDER_STATUS===9)this.AppError('骑手资格已停用，请联系管理员');await store.set(tx,'user',user._id,{...current,USER_RIDER_STATUS:2,USER_RIDER_CAMPUS:campus,USER_RIDER_REASON:'',USER_RIDER_APPLIED:Date.now()});});return {ok:true};
 }
 async riderReview(adminId,id,status,reason) {
  if(![1,8,9].includes(status))this.AppError('审核状态无效');reason=rules.text(reason,'审核说明',300,true);
  await store.transaction(async tx=>{await new Mail()._actor(tx,{adminId});const user=await store.get(tx,'user',id);if(!user||user._pid!==this.getProjectId())this.AppError('用户不存在');if(status===1 && (!user.USER_RIDER_CAMPUS||user.USER_STATUS!==1))this.AppError('用户未申请或当前不可用');await store.set(tx,'user',id,{...user,USER_RIDER_STATUS:status,USER_RIDER_REASON:reason});await store.set(tx,'operation_audit',store.key(id,Date.now(),adminId),{_pid:this.getProjectId(),action:'rider_review',adminId,userId:id,status,reason,createdAt:Date.now()});});return {ok:true};
 }
 async riders(page=1) {return this.list('user',{},page,'USER_RIDER_APPLIED', {USER_NAME:true,USER_MOBILE:true,USER_STATUS:true,USER_RIDER_STATUS:true,USER_RIDER_CAMPUS:true,USER_RIDER_REASON:true});}
 async list(collection,where,page=1,sort='createdAt',fields) {
  if(!Number.isInteger(page)||page<1||page>500)this.AppError('分页参数无效');let query=store.database().collection(store.collection(collection)).where({_pid:this.getProjectId(),...where});if(fields)query=query.field(fields);
  const result=await query.orderBy(sort,'desc').skip((page-1)*20).limit(21).get();return {list:result.data.slice(0,20),hasMore:result.data.length>20};
 }
 async notifications(userId,page) {await new Mail()._user(userId);return this.list('notification',{userId},page);}
 async markRead(userId,id) {await new Mail()._user(userId);await store.transaction(async tx=>{const row=await store.get(tx,'notification',id);if(!row||row._pid!==this.getProjectId()||row.userId!==userId)this.AppError('消息不存在');await store.set(tx,'notification',id,{...row,read:true});});return {ok:true};}
 async subscribe(userId,enabled) {await new Mail()._user(userId);if(typeof enabled!=='boolean')this.AppError('订阅设置无效');await store.set(store.database(),'subscription',store.key(this.getProjectId(),userId),{_pid:this.getProjectId(),userId,enabled,updatedAt:Date.now()});return {ok:true};}
 async orders(page,status) {const where={};if(status!==undefined&&status!==-1){if(![0,1,2,3,9,99].includes(status))this.AppError('状态无效');where.MAIL_STATUS=status;}const result=await this.list('mail',where,page,'MAIL_ADD_TIME');result.list=result.list.map(x=>rules.project(x,''));return result;}
 async overview() {
  const db=store.database(), pid=this.getProjectId();const count=async(name,where)=>{const r=await db.collection(store.collection(name)).where({_pid:pid,...where}).count();return r.total;};
  const [waiting,delivering,confirming,exceptions,completed,complaints,failedNotifications]=await Promise.all([count('mail',{MAIL_STATUS:0}),count('mail',{MAIL_STATUS:1}),count('mail',{MAIL_STATUS:2}),count('mail',{MAIL_STATUS:3}),count('mail',{MAIL_STATUS:9}),count('feedback',{FB_STATUS:0}),count('notification',{delivery:'failed'})]);
  return {waiting,delivering,confirming,exceptions,completed,complaints,failedNotifications};
 }
}
module.exports=OperationsService;
