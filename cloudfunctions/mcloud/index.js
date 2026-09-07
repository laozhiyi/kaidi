const application = require('./framework/core/application.js');
exports.main = async (event, context) => {
 const cloud = require('./framework/cloud/cloud_base.js').getCloud();
 if(event && event.Type === 'Timer' && event.TriggerName === 'operations-minute') {
  if(cloud.getWXContext().OPENID) throw new Error('定时任务不接受小程序调用');
  global.PID = 'crun';
  await new (require('./project/crun/service/base_project_service.js'))().initSetup();
  return new (require('./project/crun/service/maintenance_service.js'))().run();
 }
 return application.app(event, context);
};
