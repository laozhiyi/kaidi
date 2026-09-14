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
      if (request.endsWith('cloud_util.js')) return { getTempFileURLOne: async id => { signed.push(id); return options.signEmpty ? '' : signedURL; } };
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
  const report = await h.api.exportDataExcel('key', '订单', 1, [['订单编号'], ['one']]);
  assert.equal(report.url, h.signedURL);
  assert.equal(report.total, 1);
  assert.equal(h.saved().EXPORT_CLOUD_ID, 'cloud://new.xlsx');
  assert.match(h.uploaded[0].cloudPath, /^crun\/private-export\/key_[a-f0-9]{24}\.xlsx$/);
  assert.equal(h.deleted.flat().join(','), 'cloud://previous.xlsx');
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
