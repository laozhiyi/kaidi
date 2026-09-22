'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function client() {
  const storage = new Map(), calls = [], waits = [];
  let failures = [{ errMsg: 'cloud.callFunction:fail request timeout', errCode: -1 }, { errMsg: 'cloud.callFunction:fail network disconnected', errCode: -1 }];
  const wx = {
    getStorageSync: key => key==='crun-campus-context' ? {schoolId:'gxnu',campusId:'yucai'} : storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    cloud: { callFunction(options) {
      calls.push(options.data.params);
      const failure = failures.shift();
      if (failure && failure.code) options.success({ result: failure });
      else if (failure) options.fail(failure);
      else options.success({ result: { code: 200, data: { id: 'saved-feedback' } } });
      options.complete({});
    } }
  };
  const cloudModule = { exports: {} };
  const tenantModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/biz/tenant_biz.js'), 'utf8'), {module:tenantModule,wx});
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/helper/cloud_helper.js'), 'utf8'), {
    module: cloudModule, wx, setTimeout, clearTimeout, console: { log() {} }, require(name) {
      if (name.endsWith('/tenant_biz.js')) return tenantModule.exports;
      if (name === './helper.js') return { isDefined: value => value !== undefined && value !== null };
      if (name === './cache_helper.js') return { get: () => ({ id: 'poster' }) };
      if (name.endsWith('/page_helper.js')) return { getPID: () => 'crun' };
      return {};
    }
  });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/biz/operations_biz.js'), 'utf8'), {
    module, wx, setTimeout(fn, delay) { waits.push(delay); fn(); }, require(name) {
      if (name.endsWith('/cloud_helper.js')) return cloudModule.exports;
      if (name.endsWith('/passport_biz.js')) return { getUserId: () => 'poster' };
      if (name.endsWith('/admin_biz.js')) return { getAdminToken: () => null };
      if (name.endsWith('/md5_lib.js')) return { md5: value => crypto.createHash('md5').update(value).digest('hex') };
      throw Error('Unexpected dependency ' + name);
    }
  });
  return { api: module.exports, calls, waits, storage, failWith: value => { failures = value; } };
}

test('feedback retries two transient transport failures with one request id and increasing bounded waits', async () => {
  const f = client();
  const result = await f.api.command('feedback/insert', { content: '保持同一份申诉' }, { retries: 2 });
  assert.equal(result.id, 'saved-feedback'); assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.calls.map(call => call.requestId)).size, 1); assert.equal(f.storage.size, 0);
  assert.equal(f.waits.length, 2); assert.ok(f.waits[1] > f.waits[0]);
});

test('exhausted network retries retain the pending id while business rejection is never retried automatically', async () => {
  const f = client(), params = { content: '保留申诉内容' };
  f.failWith(Array.from({ length: 4 }, () => ({ errMsg: 'cloud.callFunction:fail timeout' })));
  await assert.rejects(f.api.command('feedback/insert', params, { retries: 2 }), error => error.retryable === true);
  assert.equal(f.calls.length, 3); assert.equal(f.storage.size, 1);
  const firstId = f.calls[0].requestId;
  f.failWith([]); await f.api.command('feedback/insert', params, { retries: 2 });
  assert.equal(f.calls[3].requestId, firstId); assert.equal(f.storage.size, 0);
  f.failWith([{ code: 1600, msg: '操作过于频繁，请稍后再试' }]);
  await assert.rejects(f.api.command('feedback/insert', params, { retries: 2 }), error => error.code === 1600);
  assert.equal(f.calls.length, 5); assert.equal(f.waits.length, 2);
});
