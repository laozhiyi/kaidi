'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, makeProfile, copy, event, flush } = require('../test-support/mail-form-harness.cjs');
const value = (list, mark) => list.find(item => item.mark === mark).val;
const formWxml = fs.readFileSync(path.join(__dirname, '../../miniprogram/projects/crun/pages/mail/add/mail_add.wxml'), 'utf8');
const fieldsWxml = fs.readFileSync(path.join(__dirname, '../../miniprogram/projects/crun/pages/mail/add/business_order_fields.wxml'), 'utf8');
const sizeGuideWxml = fs.readFileSync(path.join(__dirname, '../../miniprogram/projects/crun/pages/mail/add/mail_size_guide.wxml'), 'utf8');
const parcelTemplate = fieldsWxml.slice(fieldsWxml.indexOf('<template name="parcel-fields">'));

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
    assert.equal(Number(value(h.engine.getForms(), 'small')), 0);
    assert.equal(h.page.data.packageItems.length, 0);
    assert.equal(h.page.data.totalCount, 0);
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
  addressPage.bindOpenPlacePicker();
  addressPage.bindSelectPlace({ currentTarget: { dataset: { label: '二期' } } });
  addressPage.bindConfirmPlace();
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
    // Parcel counts start at 0 for take/send: pick one small parcel like the user does.
    if (!h.page.data.packageItems.length) h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
    h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'pickupPoint' } }, detail: { value: '一期 · 菜鸟驿站' } });
    h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'code' } }, detail: { value: 'code-' + order } });
    if (order === 1) h.page.bindMailInput(event('address2', '首单临时地址'));
    const submit = h.page.bindFormSubmit();
    await flush();
    assert.equal(h.modals.at(-1).title, '贵重物品提醒');
    h.modals.at(-1).success({ confirm: true });
    await submit;
    assert.equal(h.commands.length, order, JSON.stringify(h.errors));
    assert.equal(value(h.commands[order - 1].params.forms, 'address2'), order === 1 ? '首单临时地址' : '一期 下一单地址');
    h.modals.at(-1).success();
    h.setProfile(makeProfile('下一单地址')); await h.show();
  }
  assert.equal(value(h.commands[1].params.forms, 'packages')[0].code, 'code-2');
  assert.deepEqual(h.errors, []);
});

async function submitTake(h) {
  if (!h.page.data.packageItems.length) h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
  h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'pickupPoint' } }, detail: { value: '一期 · 菜鸟驿站' } });
  h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'code' } }, detail: { value: '12-34' } });
  const submit = h.page.bindFormSubmit();
  await flush();
  h.modals.at(-1).success({ confirm: true });
  await submit;
  return h.commands.at(-1).params.forms;
}

test('delivery requirements start at defaults, are editable and submit with take orders', async () => {
  const h = harness(); await h.start();
  assert.equal(h.page.data.riderGender, 'any');
  assert.equal(h.page.data.upstairs, false);
  assert.equal(value(h.engine.getForms(), 'riderGender'), 'any');
  assert.equal(value(h.engine.getForms(), 'upstairs'), false);
  h.page.bindRiderGenderTap({ currentTarget: { dataset: { value: 'female' } } });
  h.page.bindUpstairsTap({ currentTarget: { dataset: { value: 'true' } } });
  assert.equal(h.page.data.riderGender, 'female');
  assert.equal(h.page.data.upstairs, true);
  assert.equal(value(h.engine.getForms(), 'riderGender'), 'female');
  assert.equal(value(h.engine.getForms(), 'upstairs'), true);
  const forms = await submitTake(h);
  assert.deepEqual(h.errors, []);
  assert.equal(forms.filter(field => field.mark === 'riderGender').length, 1);
  assert.equal(forms.filter(field => field.mark === 'upstairs').length, 1);
  assert.equal(value(forms, 'riderGender'), 'female');
  assert.equal(value(forms, 'upstairs'), true);
});

test('delivery requirements render and submit only for take orders', async () => {
  assert.match(formWxml, /wx:if="\{\{serviceType === 'take'\}\}" class="pub-delivery-reqs pub-view">[\s\S]{0,200}骑手性别/);
  // 配送要求并入「02 送到哪里」卡片，位于送达地址之后、联系人卡片之前。
  const reqAt = formWxml.indexOf('pub-delivery-reqs');
  assert.ok(reqAt > formWxml.indexOf('pub-route-card') && reqAt > formWxml.indexOf('mailValues.address2'));
  assert.ok(reqAt < formWxml.indexOf('pub-contact-card'));
  assert.equal(formWxml.split('bindUpstairsTap').length - 1, 2);
  assert.equal(formWxml.split('bindRiderGenderTap').length - 1, 3);
  const h = harness({ service: 'send' }); await h.start();
  h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
  h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'pickupPoint' } }, detail: { value: '一期2栋101室门口' } });
  const submit = h.page.bindFormSubmit();
  await flush();
  h.modals.at(-1).success({ confirm: true });
  await submit;
  const forms = h.commands.at(-1).params.forms;
  assert.deepEqual(h.errors, []);
  assert.equal(value(forms, 'serviceType'), 'send');
  assert.ok(!forms.some(field => ['riderGender', 'upstairs'].includes(field.mark)));
});

test('a published order resets delivery requirements', async () => {
  const h = harness(); await h.start();
  h.page.bindRiderGenderTap({ currentTarget: { dataset: { value: 'male' } } });
  h.page.bindUpstairsTap({ currentTarget: { dataset: { value: 'true' } } });
  h.page.resetAfterPublish();
  assert.equal(h.page.data.riderGender, 'any');
  assert.equal(h.page.data.upstairs, false);
  assert.equal(value(h.page.data.formForms, 'riderGender'), 'any');
  assert.equal(value(h.page.data.formForms, 'upstairs'), false);
  assert.equal(value(h.engine.getForms(), 'riderGender'), 'any');
  assert.equal(value(h.engine.getForms(), 'upstairs'), false);
});

test('editing a take order restores its delivery requirements', async () => {
  const mail = { _id: 'order-edit', mypost: true, MAIL_STATUS: 0, MAIL_OBJ: { serviceType: 'take', riderGender: 'female', upstairs: true,
    small: 1, medium: 0, large: 0, price: 1.5, campus: '育才校区', address2: '一期 1栋101室' } };
  const h = harness({ mail }); await h.start();
  assert.equal(h.page.data.riderGender, 'female');
  assert.equal(h.page.data.upstairs, true);
  assert.equal(value(h.page.data.formForms, 'riderGender'), 'female');
  assert.equal(value(h.page.data.formForms, 'upstairs'), true);
});

test('take package cards carry no size hint on any rebuilt packageTypes', async () => {
  const withoutHint = list => assert.ok(list.every(item => !Object.prototype.hasOwnProperty.call(item, 'hint')));
  const h = harness(); await h.start();
  withoutHint(h.page.data.packageTypes);
  h.page.resetAfterPublish();
  withoutHint(h.page.data.packageTypes);

  const mail = { _id: 'order-edit', mypost: true, MAIL_STATUS: 0, MAIL_OBJ: { serviceType: 'take',
    small: 1, medium: 1, large: 1, price: 4.5, campus: '育才校区', address2: '一期 1栋101室' } };
  const edit = harness({ mail }); await edit.start();
  withoutHint(edit.page.data.packageTypes);
  edit.page.resetAfterPublish();
  withoutHint(edit.page.data.packageTypes);
  assert.ok(!parcelTemplate.includes('pub-package-hint'));
  assert.ok(!parcelTemplate.includes('item.hint'));
});

test('each package card opens the matching size guide sheet and closing clears it', async () => {
  const h = harness(); await h.start();
  assert.ok(!/data="\{\{[^}]*sizeGuide/.test(formWxml));
  assert.ok(formWxml.includes('<include src="./mail_size_guide.wxml" />'));
  assert.equal(h.page.data.sizeGuideMark, '');
  assert.equal(h.page.data.sizeGuideItem, null);
  const titles = { small: '小件 · 起步价', medium: '中件 · 标准价', large: '大件 · 加价件（可在每件包裹里自定义价格）' };
  for (const mark of ['small', 'medium', 'large']) {
    h.page.bindOpenSizeGuide({ currentTarget: { dataset: { mark } } });
    assert.equal(h.page.data.sizeGuideMark, mark);
    assert.equal(h.page.data.sizeGuideItem.title, titles[mark]);
  }
  h.page.bindOpenSizeGuide({ currentTarget: { dataset: { mark: 'small' } } });
  assert.equal(h.page.data.sizeGuideItem.size, '长宽高相加不超过 40cm，重量 3kg 以内。');
  h.page.bindOpenSizeGuide({ currentTarget: { dataset: { mark: 'large' } } });
  assert.equal(h.page.data.sizeGuideItem.scene, undefined);
  h.page.bindCloseSizeGuide();
  assert.equal(h.page.data.sizeGuideMark, '');
  assert.equal(h.page.data.sizeGuideItem, null);
  h.page.bindOpenSizeGuide({ currentTarget: { dataset: { mark: 'medium' } } });
  h.page.resetAfterPublish();
  assert.equal(h.page.data.sizeGuideMark, '');
  assert.equal(h.page.data.sizeGuideItem, null);
});

test('the embedded home form exposes the same size guide handlers', async () => {
  const h = harness({ embedded: true }); await h.start();
  h.page.bindOpenSizeGuide({ currentTarget: { dataset: { mark: 'medium' } } });
  assert.equal(h.page.data.sizeGuideMark, 'medium');
  assert.equal(h.page.data.sizeGuideItem.title, '中件 · 标准价');
  h.page.bindCloseSizeGuide();
  assert.equal(h.page.data.sizeGuideMark, '');
  assert.equal(h.page.data.sizeGuideItem, null);
});

test('the size guide keeps the reference copy verbatim and never shows prices', async () => {
  const h = harness(); await h.start();
  const [small, medium, large] = h.page.data.sizeGuide;
  assert.equal(small.size, '长宽高相加不超过 40cm，重量 3kg 以内。');
  assert.equal(small.examples, '标准快递文件袋、手机盒、一包衣服、一本书、一支洗面奶、一盒面膜。');
  assert.equal(small.scene, '单手就能轻松拿着走回宿舍，甚至可以揣进背包里。');
  assert.equal(medium.size, '长宽高相加在 40cm - 80cm 之间，重量 3kg - 10kg。');
  assert.equal(medium.examples, '标准鞋盒、一台笔记本电脑包装箱、一整箱抽纸（12卷装）、一箱牛奶（12盒装）、一袋猫砂。');
  assert.equal(medium.scene, '需要双手抱着，或者需要找个大塑料袋拎着，步行稍微有点重，骑自行车可以放在车筐或踏板上。');
  assert.equal(large.size, '任何一边超过 50cm，或长宽高相加超过 80cm，重量 10kg 以上。');
  assert.equal(large.examples, '大号整理箱、小型家电（微波炉、小洗衣机）、整箱矿泉水（24瓶）、大号毛绒玩具、组装家具包裹。');
  assert.equal(large.scene, undefined);
  for (const item of h.page.data.sizeGuide) {
    for (const text of [item.title, item.size, item.examples, item.scene || '']) assert.ok(!/[¥￥]|元/.test(text), text);
  }
  assert.ok(parcelTemplate.includes('请如实选择大小。代取人到达驿站后，若发现实际包裹明显超出所选大小，有权要求发单人补差价或取消订单，由此产生的损失由发单人承担。'));
  assert.ok(sizeGuideWxml.includes('尺寸重量：{{sizeGuideItem.size}}'));
  assert.ok(sizeGuideWxml.includes('具象参照物：{{sizeGuideItem.examples}}'));
  assert.ok(sizeGuideWxml.includes('wx:if="{{sizeGuideItem.scene}}"'));
  assert.ok(sizeGuideWxml.includes('代取场景：{{sizeGuideItem.scene}}'));
  assert.ok(!sizeGuideWxml.includes('¥'));
  assert.ok(!sizeGuideWxml.includes('pub-size-guide-warning'));
});

test('send keeps the original parcel cards and every addition stays behind the take guard', async () => {
  assert.ok(parcelTemplate.includes('wx:if="{{serviceType === \'take\'}}" class="pub-parcel-take pub-parcel-take-{{item.mark}}'));
  assert.ok(parcelTemplate.includes('wx:else class="pub-parcel pub-parcel-{{item.mark}}'));
  // 「参考」是件型卡片右上角的角标；价格行恢复原样，不再夹按钮。
  assert.ok(parcelTemplate.includes('<view wx:if="{{serviceType === \'take\'}}" class="pub-package-guide-tag pub-view" catchtap="bindOpenSizeGuide" data-mark="{{item.mark}}">参考</view>'));
  assert.equal(parcelTemplate.split('pub-package-guide').length - 1, 1);
  assert.ok(parcelTemplate.includes('<view class="pub-package-price pub-view">¥<text class="pub-text">{{item.price}}</text><text class="pub-per-item pub-text"> /件</text></view>'));
  assert.ok(!parcelTemplate.includes('pub-package-price-take'));
  assert.ok(parcelTemplate.includes("{{serviceType === 'take' ? ' pub-package-take' : ''}}"));
  assert.ok(parcelTemplate.includes("pub-card{{serviceType === 'take' ? ' pub-card-take' : ''}} pub-view"));
  // 代取不再显示底部件数统计（提交时仍会校验至少 1 件），代送照旧。
  assert.ok(parcelTemplate.includes('<view wx:if="{{serviceType !== \'take\'}}" class="pub-footnote pub-view">'));
  assert.ok(parcelTemplate.includes('wx:if="{{serviceType === \'take\'}}" class="pub-size-guide '));
  assert.equal(parcelTemplate.split('pub-size-guide ').length - 1, 1);
  assert.ok(!parcelTemplate.includes('pub-size-guide-toggle'));
  assert.ok(!parcelTemplate.includes('pub-size-guide-body'));
  assert.ok(parcelTemplate.includes('wx:if="{{serviceType !== \'take\'}}" class="pub-price-tip'));
  assert.ok(parcelTemplate.includes('请如实选择大小。代取人到达驿站后，若发现实际包裹明显超出所选大小，有权要求发单人补差价或取消订单，由此产生的损失由发单人承担。'));
  assert.ok(parcelTemplate.indexOf('pub-size-guide-warning') > parcelTemplate.indexOf('pub-packages'));
  assert.ok(parcelTemplate.indexOf('pub-size-guide-warning') < parcelTemplate.indexOf('每件包裹信息'));
  assert.ok(sizeGuideWxml.includes('wx:if="{{serviceType === \'take\' && sizeGuideMark}}"'));

  const h = harness({ service: 'send' }); await h.start();
  assert.equal(h.page.data.sizeGuideMark, '');
  h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
  h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'pickupPoint' } }, detail: { value: '一期2栋101室门口' } });
  const submit = h.page.bindFormSubmit();
  await flush();
  h.modals.at(-1).success({ confirm: true });
  await submit;
  assert.deepEqual(h.errors, []);
  const forms = h.commands.at(-1).params.forms;
  assert.equal(value(forms, 'serviceType'), 'send');
  assert.ok(!forms.some(field => ['hint', 'sizeGuide', 'sizeGuideMark', 'sizeGuideItem'].includes(field.mark)));
});

test('size hints and the size guide are never submitted', async () => {
  const h = harness(); await h.start();
  h.page.bindOpenSizeGuide({ currentTarget: { dataset: { mark: 'medium' } } });
  const forms = await submitTake(h);
  assert.deepEqual(h.errors, []);
  assert.ok(!forms.some(field => ['hint', 'sizeGuide', 'sizeGuideMark', 'sizeGuideItem'].includes(field.mark)));
  assert.ok(value(forms, 'packages').every(row => !Object.prototype.hasOwnProperty.call(row, 'hint')));
});

test('tip is a custom optional amount: it adds to the shown total, rejects invalid input and submits only with take orders', async () => {
  const h = harness(); await h.start();
  assert.equal(h.page.data.tip, 0); assert.equal(h.page.data.tipInput, '');
  const tipInput = text => h.page.bindTipInput({ detail: { value: text } });
  h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
  const base = Number(h.page.data.totalFee);
  tipInput('2.5');
  assert.equal(h.page.data.tip, 2.5); assert.equal(h.page.data.tipError, '');
  assert.equal(h.page.data.payTotal, (base + 2.5).toFixed(2));
  assert.equal(h.page.data.totalFee, base.toFixed(2), 'package total stays separate from the tip');
  for (const bad of ['25', '1.234', 'abc']) {
    tipInput(bad);
    assert.equal(h.page.data.tip, 0); assert.match(h.page.data.tipError, /0至20元/);
    assert.equal(h.page.data.payTotal, base.toFixed(2));
  }
  tipInput('');
  assert.equal(h.page.data.tipError, ''); assert.equal(h.page.data.tip, 0);
  tipInput('3');
  const forms = await submitTake(h);
  assert.deepEqual(h.errors, []);
  assert.equal(value(forms, 'tip'), '3.00');
  assert.equal(forms.filter(field => field.mark === 'tip').length, 1);
});
