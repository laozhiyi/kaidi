'use strict';
// Deploy this temporary function separately and enable it only during a
// maintenance window. It is never reachable through the mini-program router.
exports.main=async(event)=>{
 const cloud=require('./framework/cloud/cloud_base.js').getCloud();
 if(process.env.TENANT_MIGRATION_ENABLED!=='true'||!process.env.CLOUD_ENV_ID||cloud.getWXContext().OPENID)throw new Error('MIGRATION_DISABLED');
 if(!event||!['plan','apply','rollback','verify','finalize'].includes(event.action))throw new Error('INVALID_MIGRATION_ACTION');
 global.PID='crun';
 await new (require('./project/crun/service/base_project_service.js'))().initSetup();
 const service=new (require('./project/crun/service/tenant_migration_service.js'))();
 if(['rollback','verify','finalize'].includes(event.action))return service[event.action](event);
 return service.batch({...event,dryRun:event.action!=='apply'});
};
