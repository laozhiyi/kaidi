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
  event = require('./timer_event.js').normalize(event);
  if (!event) throw new Error('WORKER_TIMER_ONLY');

  const startedAt = Date.now();
  const candidate = options.expectKind || kindOf(event.TriggerName);
  const kind = ['orders', 'notifications'].includes(candidate) ? candidate : 'unknown';
  let stage = 'authorization';
  // A fixed marker is searchable in the log field even when initialization fails.
  // Never log the input event, OPENID, credentials, or business payloads.
  console.info('YUNSUQU_TIMER_START', { kind });
  try {
    const cloud = require('./framework/cloud/cloud_base.js').getCloud();
    // Client-supplied Type cannot bypass trusted identity checks.
    if (cloud.getWXContext().OPENID || kind === 'unknown') throw new Error('WORKER_TIMER_ONLY');

    stage = 'initialization';
    global.PID = 'crun';
    await new (require('./project/crun/service/base_project_service.js'))().initSetup();

    const shard = process.env.WORKER_SHARD === undefined ? undefined : Number(process.env.WORKER_SHARD);
    const budgetMs = Number(process.env.WORKER_BUDGET_MS) || Number(options.budgetMs) || 20000;
    stage = 'maintenance';
    const result = await new (require('./project/crun/service/maintenance_service.js'))().runScheduled(kind, {
      shard,
      batchSize: Number(process.env.WORKER_BATCH_SIZE) || 50,
      maxBatches: Number(process.env.WORKER_MAX_BATCHES) || 10,
      budgetMs
    });
    const counts = {};
    for (const field of ['scanned', 'processed', 'failed', 'cleanupFailed']) {
      if (Number.isSafeInteger(result && result[field]) && result[field] >= 0) counts[field] = result[field];
    }
    console.info('YUNSUQU_TIMER_DONE', { kind, durationMs: Date.now() - startedAt, ...counts });
    return result;
  } catch (error) {
    const value = String(error && (error.code || error.errCode) || '');
    const code = /^[A-Za-z0-9_-]{1,80}$/.test(value) ? value : error && error.message === 'WORKER_TIMER_ONLY' ? 'WORKER_TIMER_ONLY' : 'WORKER_FAILED';
    console.error('YUNSUQU_TIMER_FAILED', { kind, stage, code, durationMs: Date.now() - startedAt });
    throw error;
  }
}

module.exports = { run, kindOf, TRIGGERS };
