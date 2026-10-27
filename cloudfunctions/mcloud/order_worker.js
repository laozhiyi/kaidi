'use strict';
// 可选：只在需要把定时任务拆成独立函数部署时使用。
// 平时直接上传 mcloud 即可（触发器 orders-minute 会进入 mcloud/index.js 的 Timer 分支）。
const timer = require('./timer_entry.js');

exports.main = async (event) => timer.run(event, {expectKind: 'orders', budgetMs: 40000});
