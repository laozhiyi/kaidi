const application = require('./framework/core/application.js');

exports.main = async (event, context) => {
 // 定时触发器：直接在本函数内跑维护任务，不需要额外部署 worker 函数。
 // 预算 20000ms，为默认 30 秒超时留出收尾余量（函数超时调到 60 秒可设 WORKER_BUDGET_MS）。
 if (event && event.Type === 'Timer') return require('./timer_entry.js').run(event, {budgetMs: 20000});
 return application.app(event, context);
};
