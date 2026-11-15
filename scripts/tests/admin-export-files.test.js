'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function exportFiles(options = {}) {
  const original = { EXPORT_CLOUD_ID: 'cloud://previous.xlsx', EXPORT_ADD_TIME: 123 };
  let saved = original;
  const uploaded = [], deleted = [], signed = [];
  const cloud = {
    async uploadFile(input) { uploaded.push(input); if (options.uploadError) throw new Error('upload failed'); return { fileID: 'cloud://new.xlsx' }; },
    async deleteFile(input) { deleted.push(input.fileList); return { fileList: [{ status: options.deleteStatus || 0 }] }; }
  };
  const signedURL = 'https://example.invalid/report.xlsx?sign=example-signature&expires=123';
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/framework/utils/export_util.js'), 'utf8'), {
    module, console: { log() {}, warn() {} }, require(request) {
      if (request.endsWith('cloud_base.js')) return { getCloud: () => cloud };
      if (request.endsWith('cloud_util.js')) return { getTempFileURLOne: async (id, maxAge) => { signed.push({ id, maxAge }); return options.signEmpty ? '' : signedURL; } };
      if (request.endsWith('time_util.js')) return { time: () => 123, timestamp2Time: () => '2026-09-14 12:00' };
      if (request.endsWith('setup_util.js')) return { get: async () => saved, set: async (key, value) => { saved = value; }, remove: async () => { saved = null; } };
      if (request.endsWith('utils/util.js')) return { getProjectId: () => 'crun' };
      if (request === 'node-xlsx') return { build: () => Buffer.from('mock workbook') };
      if (request === 'crypto') return require('node:crypto');
      throw new Error('Unexpected dependency: ' + request);
    }
  });
  return { api: module.exports, original, saved: () => saved, uploaded, deleted, signed, signedURL };
}

test('export files return signed URLs verbatim and replace old reports only after successful generation', async () => {
  const h = exportFiles();
  assert.equal((await h.api.getExportDataURL('key')).url, h.signedURL);
  assert.equal(h.signed[0].maxAge, 86400, '导出下载链接有效期 1 天');
  const report = await h.api.exportDataExcel('key', '订单', 1, [['订单编号'], ['one']]);
  assert.equal(report.url, h.signedURL);
  assert.equal(report.total, 1);
  assert.equal(report.fileID, 'cloud://new.xlsx', '返回 fileID 供自动清理登记');
  assert.equal(h.signed[1].maxAge, 86400, '新生成的导出链接同样 1 天');
  assert.equal(h.saved().EXPORT_CLOUD_ID, 'cloud://new.xlsx');
  assert.match(h.uploaded[0].cloudPath, /^crun\/private-export\/key_[a-f0-9]{24}\.xlsx$/);
  assert.equal(h.deleted.flat().join(','), 'cloud://previous.xlsx');
});

test('only export links change their lifetime; other temp URLs keep the default', async () => {
  const calls = [];
  const cloud = { async getTempFileURL(input) { calls.push(input); return { fileList: [{ tempFileURL: 'https://example.invalid/file' }] }; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/framework/cloud/cloud_util.js'), 'utf8'), {
    module, console: { log() {}, error() {} }, Buffer, Date, process, setTimeout, clearTimeout, require(request) {
      if (request.endsWith('cloud_base.js')) return { getCloud: () => cloud };
      if (request.endsWith('config/config.js')) return {};
      throw new Error('Unexpected dependency: ' + request);
    }
  });
  await module.exports.getTempFileURLOne('cloud://bucket/plain.png');
  await module.exports.getTempFileURLOne('cloud://bucket/report.xlsx', 86400);
  const plain = JSON.parse(JSON.stringify(calls[0])), signed = JSON.parse(JSON.stringify(calls[1]));
  assert.deepEqual(plain, { fileList: ['cloud://bucket/plain.png'] }, '不传有效期时保持原样');
  assert.deepEqual(signed, { fileList: [{ fileID: 'cloud://bucket/report.xlsx', maxAge: 86400 }] });
  // 订单凭证等其他链接仍显式使用 300 秒。
  const media = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/service/private_media_service.js'), 'utf8');
  assert.equal((media.match(/maxAge:300/g) || []).length, 2);
});

test('upload and URL signing failures preserve the previous report', async () => {
  const upload = exportFiles({ uploadError: true });
  await assert.rejects(upload.api.exportDataExcel('key', '订单', 0, []), /upload failed/);
  assert.equal(upload.saved(), upload.original); assert.equal(upload.deleted.length, 0);
  const signing = exportFiles({ signEmpty: true });
  await assert.rejects(signing.api.exportDataExcel('key', '订单', 0, []), /下载链接/);
  assert.equal(signing.saved(), signing.original);
  assert.equal(signing.deleted.flat().join(','), 'cloud://new.xlsx');
  await assert.rejects(signing.api.getExportDataURL('key'), /下载链接/);
});

test('failed report deletion retains its pointer while already missing files can be cleared', async () => {
  const failed = exportFiles({ deleteStatus: -1 });
  await assert.rejects(failed.api.deleteDataExcel('key'), /重新删除/);
  assert.equal(failed.saved(), failed.original);
  const missing = exportFiles({ deleteStatus: -503003 });
  await missing.api.deleteDataExcel('key'); assert.equal(missing.saved(), null);
});
