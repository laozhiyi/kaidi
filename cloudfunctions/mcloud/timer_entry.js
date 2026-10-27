'use strict';
/**
 * 定时任务入口。
 *
 * 以前定时任务必须单独部署 ordersWorker / notificationsWorker 两个函数，
 * 改一行服务端代码就要同步重传三份副本，运维成本高。
 * 现在 mcloud 自己就能接定时触发器：index.js 检测到 Timer 事件后转到这里，
 * 只上传 mcloud 一个函数即可让「8 小时自动收货 / 超时提醒 / 通知发送」全部生效。
 *
 * 独立 worker 入口（order_worker.js / notification_worker.js）保留为薄壳，
 * 需要拆分部署时仍然可用。
 *
 * 安全：客户端也能构造 {Type:'Timer'} 调用云函数，所以必须确认调用方没有 OPENID。
 * 定时触发器触发时 getWXContext().OPENID 为空；小程序端调用一定有 OPENID。
 */

const TRIGGERS = {
  'orders-minute': 'orders',
  'notifications-minute': 'notifications'
};

/** 根据触发器名推断要跑哪一类维护任务；认不出来返回空串。 */
function kindOf(triggerName) {
  const name = String(triggerName || '').trim().toLowerCase();
  if (TRIGGERS[name]) return TRIGGERS[name];
  if (!name) return '';
  if (name.includes('notification')) return 'notifications';
  if (name.includes('order')) return 'orders';
  return '';
}

/**
 * @param {object} event      云函数事件（必须是 Timer）
 * @param {object} [options]
 * @param {string} [options.expectKind] 独立 worker 传入，强制只跑某一类任务
 * @param {number} [options.budgetMs]   本次扫描的时间预算
 */
async function run(event, options = {}) {
  if (!event || event.Type !== 'Timer') throw new Error('WORKER_TIMER_ONLY');

  const cloud = require('./framework/cloud/cloud_base.js').getCloud();
  // 客户端可以伪造 Type，但伪造不出空 OPENID。
  if (cloud.getWXContext().OPENID) throw new Error('WORKER_TIMER_ONLY');

  const kind = options.expectKind || kindOf(event.TriggerName);
  if (!['orders', 'notifications'].includes(kind)) throw new Error('WORKER_TIMER_ONLY');

  global.PID = 'crun';
  await new (require('./project/crun/service/base_project_service.js'))().initSetup();

  const shard = process.env.WORKER_SHARD === undefined ? undefined : Number(process.env.WORKER_SHARD);
  // mcloud 默认超时 30 秒，预算留出让事务收尾的余量；函数超时调到 60 秒可设 WORKER_BUDGET_MS=40000。
  const budgetMs = Number(process.env.WORKER_BUDGET_MS) || Number(options.budgetMs) || 20000;
  return new (require('./project/crun/service/maintenance_service.js'))().runScheduled(kind, {
    shard,
    batchSize: Number(process.env.WORKER_BATCH_SIZE) || 50,
    maxBatches: Number(process.env.WORKER_MAX_BATCHES) || 10,
    budgetMs
  });
}

module.exports = { run, kindOf, TRIGGERS };
