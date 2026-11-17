'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../../cloudfunctions/mcloud/project/crun');
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
const apiV3Key = 'a'.repeat(32);
const config = {
  appid: 'wx0123456789abcdef', mchid: '1234567890', publicKeyId: 'PUB_KEY_ID_123456',
  privateKey, publicKey, serial: 'ABCDEF1234', apiV3Key, ready: () => true, enabled: () => true
};
// 与 operation_store.key 一致：32 位十六进制，满足回调入口的 out_bill_no 校验
const billNo = 'a'.repeat(31) + '1';
const transferId = 'b'.repeat(32);

function notice(eventType, data) {
  const nonce = 'abcdefghijkl';
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from('transfer-bill'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final(), cipher.getAuthTag()]);
  const body = JSON.stringify({ event_type: eventType, resource: {
    algorithm: 'AEAD_AES_256_GCM', nonce, associated_data: 'transfer-bill', ciphertext: encrypted.toString('base64')
  } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.sign('RSA-SHA256', Buffer.from([timestamp, nonce, body, ''].join('\n')), privateKey).toString('base64');
  return { body, headers: { 'Wechatpay-Timestamp': timestamp, 'Wechatpay-Nonce': nonce,
    'Wechatpay-Serial': config.publicKeyId, 'Wechatpay-Signature': signature } };
}

function harness({ record, pointer, order, response }) {
  const rows = { payment: { [transferId]: record, [billNo]: pointer }, mail: { order } };
  if (!record) delete rows.payment[transferId];
  const clone = value => value && structuredClone(value);
  const calls = [];
  const tenantRuns = [];
  const store = {
    key: (...parts) => parts.join('_'), scopeKey: (...parts) => parts.join('_'), scope: () => null,
    database: () => ({}),
    collection: name => name,
    get: async (_, table, key) => clone(rows[table][key]),
    set: async (_, table, key, row) => { rows[table][key] = clone(row); },
    transaction: async fn => fn({})
  };
  const wxpay = {
    request: async (method, url) => {
      calls.push([method, url]);
      if (typeof response === 'function') return response(method, url);
      return response;
    }
  };
  const tenant = {
    system: async fn => fn(),
    run: async (scope, fn) => { tenantRuns.push(scope); return fn(); }
  };
  const apiModule = { notification: event => {
    const headers = Object.fromEntries(Object.entries(event.headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { type: JSON.parse(event.body).event_type, data: harnessDecrypt(event.body) };
  } };
  return { rows, calls, tenantRuns, store, wxpay, tenant, apiModule };
}

function harnessDecrypt(body) {
  const resource = JSON.parse(body).resource;
  const bytes = Buffer.from(resource.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(resource.nonce));
  decipher.setAuthTag(bytes.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString('utf8'));
}

function loadEarnings(h) {
  const module = { exports: {} };
  const file = path.join(root, 'service/earnings_service.js');
  const deps = {
    './operation_store.js': h.store,
    '../config/pay_config.js': config,
    './wechat_pay_api.js': h.wxpay,
    '../../../framework/core/app_error.js': Error
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, console, require: key => deps[key] }, { filename: file });
  return new module.exports();
}

function loadPayment(h, service) {
  const module = { exports: {} };
  const file = path.join(root, 'service/payment_service.js');
  const deps = {
    './operation_store.js': h.store,
    '../../../framework/cloud/cloud_base.js': { getCloud: () => ({}) },
    '../../../framework/tenancy/tenant_context.js': h.tenant,
    '../../../framework/core/app_error.js': Error,
    '../config/pay_config.js': config,
    './wechat_pay_api.js': h.apiModule,
    './earnings_service.js': function () { return service; }
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, console, require: key => deps[key] }, { filename: file });
  return new module.exports();
}

const waitingRecord = (overrides = {}) => ({
  _pid: 'crun', kind: undefined, orderId: 'order', rider: 'poster^^^rider', merchant: config.mchid, appid: config.appid,
  openid: 'rider', amount: 540, billNo, attempt: 1, mode: 'confirm', status: 'WAIT_USER_CONFIRM',
  state: 'transfer_pending', nextCheckAt: 0, attemptedAt: Date.now(), packageInfo: 'pkg', ...overrides
});
const pointer = { _pid: 'crun', kind: 'transfer_pointer', transferId, schoolId: 'school', campusId: 'campus' };
const order = { MAIL_STATUS: 9, MAIL_ACCEPT_USER_ID: 'poster^^^rider', MAIL_PAYMENT_MODE: 'wechat',
  MAIL_PAY_STATUS: 1, MAIL_TOTAL_FEE: 600, MAIL_EARNINGS_STATUS: 'pending' };

test('transfer callback locates the campus first, then updates the verified transfer state', async () => {
  const h = harness({ record: waitingRecord(), pointer, order,
    response: { out_bill_no: billNo, state: 'SUCCESS', appid: config.appid, mch_id: config.mchid, transfer_amount: 540, openid: 'rider' } });
  const earnings = loadEarnings(h);
  const service = loadPayment(h, earnings);
  const result = await service.callback(notice('MCHTRANSFER.BILL.FINISHED', { out_bill_no: billNo, state: 'SUCCESS' }));
  assert.equal(result.statusCode, 204);
  assert.equal(h.tenantRuns.length, 1);
  assert.equal(h.tenantRuns[0].schoolId, 'school');
  assert.equal(h.tenantRuns[0].campusId, 'campus');
  assert.equal(h.rows.payment[transferId].state, 'transfer_done');
  assert.equal(h.rows.payment[transferId].status, 'SUCCESS');
  assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS, 'paid');
});

test('transfer callback for an unknown bill is acknowledged without touching records', async () => {
  const h = harness({ record: waitingRecord(), pointer: undefined, order, response: null });
  const service = loadPayment(h, loadEarnings(h));
  const result = await service.callback(notice('MCHTRANSFER.BILL.FINISHED', { out_bill_no: 'unknown1', state: 'SUCCESS' }));
  assert.equal(result.statusCode, 204);
  assert.equal(h.tenantRuns.length, 0);
  assert.equal(h.calls.length, 0);
});

test('transfer callback with an invalid state is rejected before any lookup', async () => {
  const h = harness({ record: waitingRecord(), pointer, order, response: null });
  const service = loadPayment(h, loadEarnings(h));
  const result = await service.callback(notice('MCHTRANSFER.BILL.FINISHED', { out_bill_no: billNo, state: 'PROCESSING' }));
  assert.equal(result.statusCode, 400);
  assert.equal(h.calls.length, 0);
});

test('a waiting transfer is not queried before the 24 hour window closes', async () => {
  const h = harness({ record: waitingRecord({ attemptedAt: Date.now() - 3600000 }), pointer, order, response: null });
  await loadEarnings(h).reconcile(transferId);
  assert.equal(h.calls.length, 0);
});

test('an expired unconfirmed transfer is queried, cancelled and the order marked failed', async () => {
  const expiredAt = Date.now() - 25 * 3600000;
  const h = harness({ record: waitingRecord({ attemptedAt: expiredAt }), pointer, order,
    response: (method, url) => {
      if (method === 'GET') return { out_bill_no: billNo, state: 'WAIT_USER_CONFIRM', package_info: 'pkg', appid: config.appid, mch_id: config.mchid, transfer_amount: 540, openid: 'rider' };
      if (method === 'POST') return { out_bill_no: billNo, state: 'CANCELLED', appid: config.appid, mch_id: config.mchid, transfer_amount: 540, openid: 'rider' };
      return null;
    } });
  await loadEarnings(h).reconcile(transferId);
  assert.deepEqual(h.calls.map(([m, u]) => m + ' ' + u.split('?')[0]).slice(0, 2), [
    'GET /v3/fund-app/mch-transfer/transfer-bills/out-bill-no/' + billNo,
    'POST /v3/fund-app/mch-transfer/transfer-bills/out-bill-no/' + billNo + '/cancel'
  ]);
  assert.equal(h.rows.payment[transferId].state, 'transfer_done');
  assert.equal(h.rows.payment[transferId].status, 'CANCELLED');
  assert.equal(h.rows.payment[transferId].packageInfo, '');
  assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS, 'failed');
});
