'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');
const Address = require('../../miniprogram/projects/crun/biz/address_biz.js');

test('available-order location filters the delivery phase even when pickup is in a different phase', async () => {
  const f = fixture();
  async function publish(key, pickup, delivery) {
    const forms = f.forms();
    forms.find(form => form.mark === 'address1').val = pickup;
    forms.find(form => form.mark === 'address2').val = Address.formatAddress({ label: delivery, detail: '3栋201室' });
    return f.publish({ forms, requestId: f.req(key) });
  }
  const deliveryFive = await publish('five', '二期 · 中通', '五期');
  const deliveryTwo = await publish('two', '五期 · 邮政', '二期');
  for (const [phase, id] of [['五期', deliveryFive], ['二期', deliveryTwo]]) {
    const result = await f.service.getMailList('rider', { sortType: 'wait', whereEx: { 'MAIL_OBJ.address2': ['like', phase] } });
    assert.deepEqual(Array.from(result.list, row => row._id), [id]);
  }
  const legacy = await f.service.getMailList('rider', { sortType: 'wait', whereEx: { 'MAIL_OBJ.address1': ['like', '五期'] } });
  assert.deepEqual(Array.from(legacy.list, row => row._id), [deliveryFive]);
  assert.equal((await f.service.getMailList('rider', { sortType: 'wait' })).list.length, 2);
  await assert.rejects(f.service.getMailList('rider', { sortType: 'wait', whereEx: { 'MAIL_OBJ.address2': ['like', '.*'] } }), /筛选/);
});
