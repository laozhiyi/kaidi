'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, makeProfile, copy, event, flush } = require('../test-support/mail-form-harness.cjs');
const value = (list, mark) => list.find(item => item.mark === mark).val;

test('form setters match field marks when the parent supplies a different order', () => {
  const h = harness();
  const form = h.form([
    { mark: 'address2', type: 'textarea', title: '地址' }, { mark: 'img', type: 'image', title: '截图' }
  ], [{ mark: 'img', type: 'image', val: [] }, { mark: 'address2', type: 'textarea', val: '' }]);
  form.data.forms.reverse(); // a later parent property update can have its own order
  form.setOneFormVal('address2', '二期2栋201室');
  assert.equal(value(form.data.fields, 'address2'), '二期2栋201室');
  assert.deepEqual(copy(value(form.data.fields, 'img')), []);
  form.bindImgUploadCmpt({ currentTarget: { dataset: { idx: 1 } }, detail: ['cloud://proof'] });
  assert.deepEqual(copy(value(form.data.forms, 'img')), ['cloud://proof']);
  assert.equal(value(form.data.forms, 'address2'), '二期2栋201室');
});

test('form setters tolerate extra values and restore missing field values', () => {
  const h = harness();
  const form = h.form([{ mark: 'address2', type: 'textarea', title: '地址' }], []);
  form.data.forms = [{ mark: 'address2', type: 'textarea', val: '' }, { mark: 'tel2', type: 'text', val: '旧值' }];
  assert.doesNotThrow(() => form.setOneFormVal('tel2', '备用联系人'));
  assert.equal(value(form.data.forms, 'tel2'), '备用联系人');
  assert.equal(value(form.data.fields, 'address2'), '');
  form.data.forms = [];
  form.setOneFormVal('address2', '一期1栋101室');
  assert.equal(value(form.data.forms, 'address2'), '一期1栋101室');
  assert.equal(value(form.data.fields, 'address2'), '一期1栋101室');
});

for (const embedded of [false, true]) {
  const label = embedded ? 'embedded home form' : 'standalone order page';
  test(label + ': saved defaults update the real form without changing image types', async () => {
    const h = harness({ embedded }); await h.start();
    h.setProfile(makeProfile('2栋202室')); await h.show();
    assert.equal(h.page.data.mailValues.address2, '一期 2栋202室');
    assert.equal(value(h.engine.data.fields, 'address2'), '一期 2栋202室');
    assert.equal(value(h.engine.data.fields, 'poster'), '联系人');
    assert.equal(value(h.engine.data.fields, 'tel'), '13900000000');
    assert.deepEqual(copy(value(h.engine.data.fields, 'img')), []);
    assert.deepEqual(h.errors, []);
  });

  test(label + ': a completed order resets both snapshots and accepts the next saved address', async () => {
    const h = harness({ embedded }); await h.start();
    h.page.bindMailInput(event('address2', '上单临时地址'));
    h.page.bindMailInput(event('desc', '只适用于上单'));
    h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
    assert.doesNotThrow(() => h.page.resetAfterPublish());
    h.setProfile(makeProfile('3栋303室')); await h.show();
    assert.equal(h.page.data.mailValues.address2, '一期 3栋303室');
    assert.equal(value(h.page.data.formForms, 'desc'), '');
    assert.equal(value(h.engine.getForms(), 'desc'), '');
    assert.equal(Number(value(h.engine.getForms(), 'small')), 1);
    assert.equal(h.page.data.packageItems.length, 1);
    assert.equal(h.page.data.packageItems[0].pickupPoint, '');
    assert.deepEqual(copy(value(h.engine.data.fields, 'img')), []);
    assert.deepEqual(h.errors, []);
  });

  for (const address of ['本单临时地址', '']) test(label + ': refreshing defaults preserves an edited or cleared draft: ' + JSON.stringify(address), async () => {
    const h = harness({ embedded }); await h.start();
    h.page.bindMailInput(event('address2', address));
    h.setProfile(makeProfile('新常用地址')); await h.show();
    assert.equal(h.page.data.mailValues.address2, address);
    assert.equal(value(h.engine.getForms(), 'address2'), address);
  });
}

test('an older profile response cannot undo a more recently saved default address', async () => {
  const pending = [];
  const h = harness({ readProfile: () => new Promise(resolve => pending.push(resolve)) });
  const start = h.start(); await flush();
  const show = h.show(); await flush();
  pending[1](makeProfile('新地址')); await show;
  pending[0](makeProfile('旧地址')); await start;
  assert.equal(h.page.data.mailValues.address2, '一期 新地址');
  assert.equal(value(h.engine.getForms(), 'address2'), '一期 新地址');
});

test('refreshing personal defaults does not replace an existing order being edited', async () => {
  const h = harness({ mail: { _id: 'existing-order', MAIL_STATUS: 0, mypost: true,
    MAIL_CATE_ID: 1, MAIL_FORMS: [], MAIL_OBJ: { address2: '原订单目的地', poster: '原联系人', tel: '13700000000', small: 1, price: 1.5 } } });
  await h.start(); h.setProfile(makeProfile('新常用地址')); await h.show();
  assert.equal(h.page.data.mailValues.address2, '原订单目的地');
  assert.equal(value(h.engine.getForms(), 'address2'), '原订单目的地');
});

test('saving the first common address fills the home form through the actual profile save methods', async () => {
  const h = harness({ embedded: true, profile: makeProfile('') }); await h.start();
  const methods = h.load('miniprogram/projects/crun/pages/my/profile_methods.js');
  const addressPage = h.instance({ data: {}, methods });
  methods.applyUser(addressPage, h.getProfile());
  addressPage.bindAddAddress();
  addressPage.bindAddressPhase({ currentTarget: { dataset: { phase: '二期' } } });
  addressPage.bindAddressInput({ currentTarget: { dataset: { field: 'detail' } }, detail: { value: '2栋202室' } });
  assert.equal(await addressPage.bindSaveAddress(), true);
  await h.show();
  assert.equal(h.page.data.mailValues.address2, '二期 2栋202室');
  assert.equal(value(h.engine.getForms(), 'address2'), '二期 2栋202室');
  assert.equal(h.page.data.mailValues.poster, '联系人');
  assert.deepEqual(copy(value(h.engine.data.fields, 'img')), []);
  assert.deepEqual(h.errors, []);
});

test('two consecutive home submissions use fresh parcel data and the refreshed default address', async () => {
  const h = harness({ embedded: true }); await h.start();
  h.page.triggerEvent = name => { if (name === 'published') h.page.resetAfterPublish(); };
  for (const order of [1, 2]) {
    h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'pickupPoint' } }, detail: { value: '一期 · 菜鸟驿站' } });
    h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'code' } }, detail: { value: 'code-' + order } });
    if (order === 1) h.page.bindMailInput(event('address2', '首单临时地址'));
    await h.page.bindFormSubmit();
    assert.equal(h.commands.length, order, JSON.stringify(h.errors));
    assert.equal(value(h.commands[order - 1].params.forms, 'address2'), order === 1 ? '首单临时地址' : '一期 下一单地址');
    h.modals.at(-1).success();
    h.setProfile(makeProfile('下一单地址')); await h.show();
  }
  assert.equal(value(h.commands[1].params.forms, 'packages')[0].code, 'code-2');
  assert.deepEqual(h.errors, []);
});
