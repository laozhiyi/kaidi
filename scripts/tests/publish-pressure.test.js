'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runPublishPressure, verifyReport } = require('../test-support/publish-pressure.cjs');

for (const users of [100, 300, 1000]) {
 test(users + ' distinct users publish distinct orders concurrently with production retry limits', { timeout: 60000 }, async t => {
  const report = await runPublishPressure({ users });
  t.diagnostic(JSON.stringify(report));
  verifyReport(report);
 });
}

test('100 identities publish five distinct orders each through 500 simultaneous clients without losing quota entries', { timeout: 60000 }, async t => {
 const report = await runPublishPressure({ users: 100, perUser: 5 });
 t.diagnostic(JSON.stringify(report));
 verifyReport(report);
});

test('200 distinct image orders survive injected write failures and lost post-commit responses without duplication', { timeout: 60000 }, async t => {
 const report = await runPublishPressure({ users: 200, images: 6, lostReplyEvery: 4, failedWriteEvery: 10 });
 t.diagnostic(JSON.stringify(report));
 verifyReport(report);
 assert.equal(report.lostReplies, 50);
 assert.equal(report.failedWrites, 20);
 assert.ok(report.clientRetries >= 50);
});
