'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const Config = require('./operation_config_service.js');
const rules = require('./order_rules.js');
class OperationsService extends Base {
 async config(userId) { return {...await new Config().getConfig(),templateId:process.env.ORDER_SUBSCRIBE_TEMPLATE_ID || '',uploadPrefix:'private/'+userId.split('^^^').pop()+'/'}; }
 async notifications(userId,page) {await new Mail()._user(userId);return this.list('notification',{userId},page);}
 async markRead(userId,id) {await new Mail()._user(userId);await store.transaction(async tx=>{const row=await store.get(tx,'notification',id);if(!row||row._pid!==this.getProjectId()||row.userId!==userId)this.AppError('消息不存在');await store.set(tx,'notification',id,{...row,read:true});});return {ok:true};}
 async subscribe(userId,enabled) {await new Mail()._user(userId);if(typeof enabled!=='boolean')this.AppError('订阅设置无效');await store.set(store.database(),'subscription',store.key(this.getProjectId(),userId),{_pid:this.getProjectId(),userId,enabled,updatedAt:Date.now()});return {ok:true};}
 async orders(page,status) {const where={};if(status!==undefined&&status!==-1){if(![0,1,2,3,4,9,99].includes(status))this.AppError('状态无效');where.MAIL_STATUS=status;}const result=await this.list('mail',where,page,'MAIL_ADD_TIME');result.list=result.list.map(x=>rules.project(x,''));return result;}
 async overview() {
  const db=store.database(), pid=this.getProjectId();const count=async(name,where)=>{const r=await db.collection(store.collection(name)).where({_pid:pid,...where}).count();return r.total;};
  const [waiting,accepted,picked,confirming,exceptions,completed,complaints,failedNotifications]=await Promise.all([count('mail',{MAIL_STATUS:0}),count('mail',{MAIL_STATUS:1}),count('mail',{MAIL_STATUS:4}),count('mail',{MAIL_STATUS:2}),count('mail',{MAIL_STATUS:3}),count('mail',{MAIL_STATUS:9}),count('feedback',{FB_STATUS:0}),count('notification',{delivery:'failed'})]);
  const delivering = accepted + picked;
  return {waiting,accepted,picked,delivering,confirming,exceptions,completed,complaints,failedNotifications,total:waiting + delivering + confirming + exceptions + completed};
 }
}
module.exports=OperationsService;
