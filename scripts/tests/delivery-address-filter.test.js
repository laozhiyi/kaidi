'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');
const Address = require('../../miniprogram/projects/crun/biz/address_biz.js');
const DeliveryAddress = require('../../cloudfunctions/mcloud/project/crun/service/delivery_address.js');

test('the submitted order address is authoritative even when the object snapshot has a different detail or phase', () => {
  for (const address2 of ['47', '四期 47', '二期 64', '']) {
    const mail = { MAIL_OBJ: { campus: '雁山校区', address2, addressPhase: '二期' }, MAIL_FORMS: [
      { mark: 'campus', val: '雁山校区' }, { mark: 'address2', val: '四期 64' }
    ] };
    assert.equal(Address.formatOrderAddress(mail), '雁山校区 · 四期 64');
    assert.equal(DeliveryAddress.complete(mail).MAIL_OBJ.address2, '四期 64');
  }
});

test('delivery labels combine campus, saved phase and detail consistently without duplicating either prefix', () => {
  for (const phase of Address.PHASES) {
    const campus = '育才校区', detail = '3栋201室（靠近二期食堂）', expected = campus + ' · ' + phase + ' ' + detail;
    for (const address2 of [detail, campus + ' · ' + detail, phase + ' ' + detail, expected]) {
      for (const snapshot of [{ MAIL_OBJ: { campus, address2, addressPhase: phase } },
        { MAIL_OBJ: { campus, address2 }, MAIL_FORMS: [{ mark: 'addressPhase', val: phase }] }]) {
        assert.equal(Address.formatOrderAddress(snapshot), expected);
        assert.equal(Address.formatOrderAddress(DeliveryAddress.complete(snapshot)), expected);
      }
    }
    const legacy = { MAIL_OBJ: { campus, address2: detail }, MAIL_FORMS: [{ mark: 'address2', val: phase + ' ' + detail }] };
    assert.equal(Address.formatOrderAddress(legacy), expected);
    assert.equal(Address.formatOrderAddress(DeliveryAddress.complete(legacy)), expected);
  }
});

test('delivery labels repair legacy fields that mixed campus, detail, and phase', () => {
  const mail = { MAIL_FORMS: [
    { mark: 'campus', val: '育才校区 3栋201室。' },
    { mark: 'address2', val: '二期' }
  ] };
  assert.equal(Address.formatOrderAddress(mail), '育才校区 · 二期 3栋201室。');
  assert.equal(DeliveryAddress.complete(mail).MAIL_OBJ.address2, '二期 3栋201室。');
});

test('the order retains its selected phase after the saved profile changes', async () => {
  const f = fixture(), forms = f.forms();
  forms.push({ mark: 'addressPhase', val: '五期' });
  const id = await f.publish({ forms }), row = f.table('mail').get(id);
  assert.equal(row.MAIL_OBJ.address2, '五期 宿舍101');
  assert.equal(row.MAIL_OBJ.addressPhase, '五期');
  saveAddresses(f, [{ label: '二期', detail: '宿舍101' }], { USER_EDIT_TIME: Date.now() + 60000 });
  for (const mail of [await f.service.viewMail('rider', id), (await f.service.getMailList('rider', { sortType: 'wait' })).list[0]]) {
    assert.equal(mail.MAIL_OBJ.addressPhase, '五期');
    assert.equal(Address.formatOrderAddress(mail), f.config.campuses[0] + ' · 五期 宿舍101');
  }
});

test('publishing rejects invalid or conflicting delivery phases', async () => {
  const f = fixture();
  for (const [index, phase] of ['六期', ['五期'], '二期'].entries()) {
    const forms = f.forms();
    forms.find(item => item.mark === 'address2').val = '五期 宿舍101';
    forms.push({ mark: 'addressPhase', val: phase });
    await assert.rejects(f.publish({ forms, requestId: f.req('bad-phase-' + index) }), /期数/);
  }
});

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
  for (const [phase, id, pickup] of [['五期', deliveryFive, '二期 · 中通'], ['二期', deliveryTwo, '五期 · 邮政']]) {
    const result = await f.service.getMailList('rider', { sortType: 'wait', whereEx: { 'MAIL_OBJ.address2': ['like', phase] } });
    assert.deepEqual(Array.from(result.list, row => row._id), [id]);
    assert.equal(result.list[0].MAIL_OBJ.address1, pickup);
    assert.equal(result.list[0].MAIL_OBJ.address2, Address.formatAddress({ label: phase, detail: '3栋201室' }));
  }
  const legacy = await f.service.getMailList('rider', { sortType: 'wait', whereEx: { 'MAIL_OBJ.address1': ['like', '五期'] } });
  assert.deepEqual(Array.from(legacy.list, row => row._id), [deliveryFive]);
  assert.equal((await f.service.getMailList('rider', { sortType: 'wait' })).list.length, 2);
  await assert.rejects(f.service.getMailList('rider', { sortType: 'wait', whereEx: { 'MAIL_OBJ.address2': ['like', '.*'] } }), /筛选/);
});

function saveAddresses(f, addresses, extra = {}) {
  f.user('poster', { USER_EDIT_TIME: Date.now() - 60000, USER_FORMS: [
    { mark: 'campus', val: f.config.campuses[0] }, { mark: 'addresses', val: addresses }
  ], ...extra });
}

test('publishing and editing preserve the submitted address instead of replacing it with a matching profile address', async () => {
  const f = fixture();
  saveAddresses(f, [{ label: '五期', detail: '64' }]);
  const forms = f.forms(); forms.find(form => form.mark === 'address2').val = '四期 64';
  const id = await f.publish({ forms });
  assert.equal(f.table('mail').get(id).MAIL_OBJ.address2, '四期 64');
  assert.equal(f.table('mail').get(id).MAIL_FORMS.find(form => form.mark === 'address2').val, '四期 64');
  saveAddresses(f, [{ label: '三期', detail: '65' }]);
  forms.find(form => form.mark === 'address2').val = '二期 65';
  await f.service.editMail('poster', { id, forms, requestId: f.req('address-edit') });
  assert.equal(f.table('mail').get(id).MAIL_OBJ.address2, '二期 65');
  await f.service.acceptMail('rider', id, { requestId: f.req('address-take') });
  assert.equal((await f.service.viewMail('rider', id)).MAIL_OBJ.address2, '二期 65');
});

test('legacy orders recover the complete address from their own saved form without consulting the profile', async () => {
  const f = fixture(), id = await f.publish(), row = f.table('mail').get(id);
  row.MAIL_FORMS.find(form => form.mark === 'address2').val = '三期 宿舍101';
  saveAddresses(f, [{ label: '五期', detail: '宿舍101' }]);
  const original = structuredClone(row);
  for (const mail of [await f.service.viewMail('rider', id), await f.service.getMailDetail('poster', id),
    (await f.service.getMailList('rider', { sortType: 'wait' })).list[0]]) {
    assert.equal(mail.MAIL_OBJ.address2, '三期 宿舍101');
  }
  assert.deepEqual(f.table('mail').get(id), original, 'reading an old order must not rewrite its stored history');
});

test('legacy detail and rider lists use the saved order address without exposing private form data', async () => {
  for (const serialize of [value => value, JSON.stringify]) {
    const f = fixture(), id = await f.publish();
    f.table('mail').get(id).MAIL_FORMS.find(form => form.mark === 'address2').val = '五期 宿舍101';
    saveAddresses(f, serialize([{ label: '一期', detail: '另一栋301室', isDefault: true }, { label: '二期', detail: '宿舍101' }]));
    for (const mail of [await f.service.viewMail('rider', id), (await f.service.getMailList('rider', { sortType: 'wait' })).list[0]]) {
      assert.equal(mail.MAIL_OBJ.address2, '五期 宿舍101');
      for (const value of ['USER_FORMS', 'USER_OBJ', '另一栋301室', '小王', '13800000000', '123-456']) assert.ok(!JSON.stringify(mail).includes(value), value);
    }
    await f.service.acceptMail('rider', id, { requestId: f.req('legacy-take') });
    await f.service.pickupMail('rider', id, { requestId: f.req('legacy-pickup') });
    assert.equal((await f.service.viewMail('rider', id)).MAIL_OBJ.address2, '五期 宿舍101');
    assert.equal((await f.service.getMailList('rider', { sortType: 'my_accept' })).list[0].MAIL_OBJ.address2, '五期 宿舍101');
    assert.equal(f.table('mail').get(id).MAIL_OBJ.address2, '宿舍101');
  }
});

test('an order address is never inferred from the publisher profile, even if the detail matches exactly', async () => {
  for (const [addresses, extra] of [
    [[{ label: '一期', detail: '宿舍101', isDefault: true }], {}],
    [[{ label: '一期', detail: '宿舍101', isDefault: true }, { label: '二期', detail: '宿舍101' }], {}],
    [[{ label: '一期', detail: '宿舍1010' }], {}],
    [[{ label: '宿舍', detail: '宿舍101' }], {}],
    [[{ label: '一期', detail: '宿舍101' }], { USER_EDIT_TIME: Date.now() + 60000 }],
    [[], { USER_FORMS: [{ mark: 'campus', val: '其他校区' }, { mark: 'addresses', val: [{ label: '一期', detail: '宿舍101' }] }] }]
  ]) {
    const f = fixture(), id = await f.publish(); saveAddresses(f, addresses, extra);
    assert.equal((await f.service.viewMail('rider', id)).MAIL_OBJ.address2, '宿舍101');
  }
});

test('paginated lists fetch the published address in the order query and remove private forms after projection', async () => {
  const f = fixture({ projectFields: true });
  for (let index = 0; index < 3; index++) {
    const forms = f.forms();
    forms.find(form => form.mark === 'address2').val = '四期 64';
    const id = await f.publish({ forms, requestId: f.req('project-' + index) });
    Object.assign(f.table('mail').get(id).MAIL_OBJ, { address2: ['47', '二期 47', ''][index], addressPhase: '二期' });
  }
  for (const page of [1, 2]) {
    f.reads.length = 0;
    const result = await f.service.getMailList('other', { sortType: 'wait', page, size: 2 });
    assert.equal(result.list.length, page === 1 ? 2 : 1);
    for (const mail of result.list) {
      assert.equal(mail.MAIL_OBJ.address2, '四期 64');
      assert.equal(mail.MAIL_OBJ.addressPhase, '四期');
      for (const value of ['MAIL_FORMS', '123-456', '小王', '13800000000']) assert.ok(!JSON.stringify(mail).includes(value), value);
    }
    const queries = f.reads.filter(read => read.name === 'mail');
    assert.equal(queries.length, 1, 'no supplementary address lookup is needed');
    assert.ok(queries[0].fields.split(',').includes('MAIL_FORMS'));
    assert.ok(!f.reads.some(read => read.name === 'user' && read.method === 'getAll'), 'addresses must not be taken from user profiles');
  }
});
