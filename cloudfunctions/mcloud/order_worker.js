'use strict';
exports.main=async(event)=>{
 const cloud=require('./framework/cloud/cloud_base.js').getCloud();
 if(!event || event.Type!=='Timer' || event.TriggerName!=='orders-minute' || cloud.getWXContext().OPENID)throw new Error('WORKER_TIMER_ONLY');
 global.PID='crun';
 await new (require('./project/crun/service/base_project_service.js'))().initSetup();
 const shard=process.env.WORKER_SHARD===undefined?undefined:Number(process.env.WORKER_SHARD);
 return new (require('./project/crun/service/maintenance_service.js'))().runScheduled('orders',{shard,batchSize:Number(process.env.WORKER_BATCH_SIZE)||50,maxBatches:Number(process.env.WORKER_MAX_BATCHES)||10,budgetMs:40000});
};
