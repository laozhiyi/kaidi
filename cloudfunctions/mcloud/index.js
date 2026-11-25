const application = require('./framework/core/application.js');
const timerEvent = require('./timer_event.js');

exports.main = async (event, context) => {
 if (event && !event.route && event.httpMethod === 'POST' && !Object.keys(event.headers || {}).some(k => k.toLowerCase() === 'wechatpay-signature')) return new (require('./project/crun/service/adapay_payment_service.js'))().callback(event);
 if (event && !event.route && event.httpMethod === 'POST') return new (require('./project/crun/service/payment_service.js'))().callback(event);
 // 定时触发器：直接在本函数内跑维护任务，不需要额外部署 worker 函数。
 // 预算 20000ms，为默认 30 秒超时留出收尾余量（函数超时调到 60 秒可设 WORKER_BUDGET_MS）。
 const timer = timerEvent.normalize(event);
 if (timer) {
  console.info('YUNSUQU_ENTRY_TIMER_V2');
  return require('./timer_entry.js').run(timer, {budgetMs: 20000});
 }
 if (!event || !event.route) {
  // Record shape flags only, never arbitrary payload values or event contents.
  console.error('YUNSUQU_ENTRY_UNROUTED_V2', {
   inputType: event === null ? 'null' : Array.isArray(event) ? 'array' : typeof event,
   hasUpperType: Boolean(event && Object.prototype.hasOwnProperty.call(event, 'Type')),
   hasLowerType: Boolean(event && Object.prototype.hasOwnProperty.call(event, 'type')),
   hasUpperTrigger: Boolean(event && Object.prototype.hasOwnProperty.call(event, 'TriggerName')),
   hasLowerTrigger: Boolean(event && Object.prototype.hasOwnProperty.call(event, 'triggerName'))
  });
 }
 return application.app(event, context);
};
