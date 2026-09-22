'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The consumer, production cloud wrapper and installed SDK all run together.
// Each standalone probe intercepts network transport and uses synthetic data.
for (const [name, script] of [
  ['manual registration and moderation', 'check-content-audit-sdk.cjs'],
  ['phone authorization', 'check-wechat-login-sdk.cjs'],
  ['scoped database operations and notifications', 'check-operations-sdk.cjs']
]) {
  test('production cloud wrapper supports ' + name + ' with the installed SDK', () => {
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', script)], {
      cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 20000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /no network/);
  });
}
