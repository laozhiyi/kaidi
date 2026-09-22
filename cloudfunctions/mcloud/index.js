const application = require('./framework/core/application.js');
exports.main = async (event, context) => {
 if(event && event.Type === 'Timer') throw new Error('请使用独立订单或通知维护函数');
 return application.app(event, context);
};
