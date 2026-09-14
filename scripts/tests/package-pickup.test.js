'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const { fixture } = require('../test-support/operations-fixture.cjs');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const Address = require('../../miniprogram/projects/crun/biz/address_biz.js');
const Deadline = require('../../miniprogram/projects/crun/biz/deadline_biz.js');
const setting = require('../../miniprogram/projects/crun/public/project_setting.js');
const root = path.resolve(__dirname, '../..');
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const copy = value => JSON.parse(JSON.stringify(value));

async function formHarness(entry = 'mail_add.js', options = {}) {
 const f = options.backend || fixture(), calls = [], errors = [], uploads = [];
 let definition, component;
 const wx = { setNavigationBarTitle() {}, showLoading() {}, hideLoading() {}, hideKeyboard() {}, showModal() {}, showToast() {}, stopPullDownRefresh() {} };
 runMiniProgram(path.join(root, 'miniprogram/projects/crun/pages/mail/add', entry), { wx, console,
  Page: value => { definition = value; }, Component: value => { component = value; }, require(name) {
   if (name.includes('mail_ui_biz')) return UI;
   if (name.includes('address_biz')) return Address;
   if (name.includes('deadline_biz')) return Deadline;
   if (name.includes('passport_biz')) return { isLogin: () => false, loginMustBackWin: async () => true, loginMustCancelWin: async () => true };
   if (name.includes('project_biz')) return { initPage() {} };
   if (name.includes('mail_biz')) return { CHECK_FORM: {}, initFormData: () => ({ fields: setting.MAIL_FIELDS, formCateId: '1', formOrder: 9999 }) };
   if (name.includes('/validate.js')) return { check: data => ({ cateId: data.formCateId, end: data.formEnd }) };
   if (name.includes('cloud_helper')) return { callCloudSumbit: async () => ({ data: options.mail }) };
   if (name.includes('public_biz')) return { removeCacheList() {} };
   if (name.includes('operations_biz')) return { get: async () => f.config, pendingCommand: () => null, error: error => errors.push(error.message),
    upload: async images => { uploads.push(copy(images)); return images.map(image => image.startsWith('cloud://') ? image : 'cloud://fixture/private-evidence/poster/' + image); },
    command: async (route, params) => { calls.push({ route, params: copy(params) }); return options.backend ? f.service.insertMail('poster', { ...params, requestId: f.req('client-publish') }) : { _id: 'saved' }; }
   };
   return {};
  }
 });
 if (component) definition = { data: component.data, ...component.methods };
 const page = { ...definition, data: copy(definition.data), triggerEvent() {}, setData(patch, callback) {
  for (const [key, value] of Object.entries(patch)) {
   const parts = key.split('.'); let target = this.data;
   for (const part of parts.slice(0, -1)) target = target[part] ||= {};
   target[parts.at(-1)] = value;
  }
  if (callback) callback();
 }, selectComponent() { return { data: { forms: this.data.formForms || [] }, getForms: () => this.data.formForms, setOneFormVal() {}, reload() {} }; } };
 if (component) { component.lifetimes.attached.call(page); await new Promise(resolve => setImmediate(resolve)); }
 else await page.onLoad(options.mail ? { id: options.mail._id } : {});
 assert.equal(page.data.isLoad, true);
 return { page, calls, errors, uploads, backend: f };
}

function setPickup(page, index, phase, name) {
 page.bindOpenPackagePickup(event({ id: page.data.packageItems[index].id }));
 page.bindSelectPackagePickup(event({ phase, name }));
 page.bindConfirmPackagePickup();
}

for (const entry of ['mail_add.js', 'mail_add_embedded.js']) {
 test(entry + ': each parcel selects its own pickup point and cancellation preserves the saved choice', async () => {
  const { page } = await formHarness(entry);
  page.bindPackageTap(event({ index: 0, step: 1 }));
  page.bindPackageItemInput(event({ index: 0, mark: 'code' }, 'FIRST-CODE'));
  page.bindPackageItemInput(event({ index: 1, mark: 'code' }, 'SECOND-CODE'));
  setPickup(page, 0, '二期', '中通'); setPickup(page, 1, '五期', '邮政');
  assert.deepEqual(Array.from(page.data.packageItems, item => [item.code, item.pickupPoint]), [['FIRST-CODE', '二期 · 中通'], ['SECOND-CODE', '五期 · 邮政']]);
  page.bindOpenPackagePickup(event({ id: page.data.packageItems[0].id }));
  assert.equal(page.data.packagePickupDraft, '二期 · 中通');
  page.bindSelectPackagePickup(event({ phase: '奥林苑', name: '京东' })); page.bindClosePackagePickup();
  assert.equal(page.data.packageItems[0].pickupPoint, '二期 · 中通');
  page.bindOpenPackagePickup(event({ id: page.data.packageItems[1].id }));
  page.bindPackagePickupInput(event({}, '  校门口临时取件柜  ')); page.bindConfirmPackagePickup();
  assert.equal(page.data.packageItems[1].pickupPoint, '校门口临时取件柜');
  assert.equal(page.data.mailValues.address1, undefined);
  assert.ok(!page.data.formForms.some(field => field.mark === 'address1'));
  assert.ok(!page.data.fields.some(field => field.mark === 'address1'));
 });
}

test('adding, removing and refreshing parcels keeps the picker attached to the same parcel', async () => {
 const { page } = await formHarness();
 page.bindPackageTap(event({ index: 1, step: 1 }));
 const mediumId = page.data.packageItems[1].id;
 page.bindPackageItemInput(event({ index: 1, mark: 'code' }, 'MEDIUM-CODE'));
 page.bindPackageItemInput(event({ index: 1, mark: 'price' }, '4.25'));
 page.bindOpenPackagePickup(event({ id: mediumId }));
 page.bindSelectPackagePickup(event({ phase: '奥林苑', name: '京东' }));
 page.bindPackageTap(event({ index: 0, step: 1 }));
 assert.equal(page.data.packagePickupNumber, 3);
 page.bindConfirmPackagePickup();
 const medium = page.data.packageItems.find(item => item.id === mediumId);
 assert.equal(medium.pickupPoint, '奥林苑 · 京东'); assert.equal(medium.code, 'MEDIUM-CODE'); assert.equal(medium.price, '4.25');
 const removedId = page.data.packageItems[1].id;
 page.bindPackageTap(event({ index: 0, step: -1 })); page.bindPackageTap(event({ index: 0, step: 1 }));
 assert.notEqual(page.data.packageItems[1].id, removedId); assert.equal(page.data.packageItems[1].pickupPoint, '');
 await page.bindRetryLoad();
 assert.equal(page.data.packageItems.find(item => item.id === mediumId).pickupPoint, '奥林苑 · 京东');
 assert.equal(page.data.totalFee, (2 * page.data.config.smallPrice + 4.25).toFixed(2));
 page.bindOpenPackagePickup(event({ id: mediumId })); page.bindPackageTap(event({ index: 1, step: -1 }));
 assert.equal(page.data.packagePickupVisible, false);
});

test('editing restores every stored parcel even when database records have no client ids', async () => {
 const packages = [{ type: 'small', price: 2.25, code: 'A', pickupPoint: '二期 · 中通', images: [] }, { type: 'small', price: 3.5, code: 'B', pickupPoint: '五期 · 邮政', images: [] }];
 const mail = { _id: 'existing', mypost: true, MAIL_STATUS: 0, MAIL_OBJ: { small: 2, price: 5.75, packages }, MAIL_FORMS: [] };
 const { page } = await formHarness('mail_add.js', { mail });
 assert.deepEqual(Array.from(page.data.packageItems, item => [item.code, item.pickupPoint, item.price]), packages.map(item => [item.code, item.pickupPoint, item.price]));
 assert.equal(new Set(page.data.packageItems.map(item => item.id)).size, 2);
 await page.bindRetryLoad(); assert.equal(page.data.packageItems[1].code, 'B');
 const legacy = { ...mail, MAIL_OBJ: { ...mail.MAIL_OBJ, address1: '旧快递点', packages: packages.map(({ pickupPoint, ...item }) => item) } };
 const old = await formHarness('mail_add.js', { mail: legacy });
 assert.ok(old.page.data.packageItems.every(item => item.pickupPoint === '旧快递点'));
 setPickup(old.page, 1, '五期', '邮政');
 assert.equal(old.page.data.packageItems[0].pickupPoint, '旧快递点');
});

test('publishing requires each pickup point before any upload and resets the next draft', async () => {
 const { page, calls, uploads, errors } = await formHarness('mail_add_embedded.js');
 page.bindPackageTap(event({ index: 0, step: 1 })); setPickup(page, 0, '二期', '中通');
 await page.bindFormSubmit();
 assert.match(errors[0], /第2件包裹的取件点/); assert.equal(calls.length, 0); assert.equal(uploads.length, 0);
 setPickup(page, 1, '五期', '邮政');
 page.bindOpenPackagePickup(event({ id: page.data.packageItems[0].id }));
 page.bindPackagePickupInput(event({}, '   ')); page.bindConfirmPackagePickup();
 assert.match(page.data.packagePickupError, /取件点/); assert.equal(page.data.packageItems[0].pickupPoint, '二期 · 中通');
 page.resetAfterPublish();
 assert.equal(page.data.packageItems.length, 1); assert.equal(page.data.packageItems[0].pickupPoint, ''); assert.equal(page.data.packagePickupVisible, false);
});

test('home submission saves point/code/image pairs and only participants receive them', async () => {
 const f = fixture(), { page, calls, errors } = await formHarness('mail_add_embedded.js', { backend: f });
 page.bindPackageTap(event({ index: 0, step: 1 }));
 setPickup(page, 0, '二期', '中通'); setPickup(page, 1, '五期', '邮政');
 page.bindPackageItemInput(event({ index: 0, mark: 'code' }, 'PAIR-CODE'));
 page.data.packageItems[1].images = ['parcel.png'];
 for (const [mark, value] of Object.entries({ address2: '一期1栋101', poster: '小王', tel: '13800000000' })) page.bindMailInput(event({ mark }, value));
 await page.bindFormSubmit(); assert.deepEqual(errors, []); assert.equal(calls.length, 1);
 assert.ok(!calls[0].params.forms.some(field => ['address1', 'code', 'img'].includes(field.mark)));
 const stored = f.table('mail').get(page.data.mailId);
 assert.deepEqual(stored.MAIL_OBJ.packages.map(item => [item.code, item.pickupPoint]), [['PAIR-CODE', '二期 · 中通'], ['', '五期 · 邮政']]);
 assert.equal(stored.MAIL_OBJ.address1, '二期 · 中通；五期 · 邮政');
 assert.ok(!JSON.stringify(await f.service.viewMail('rider', stored._id)).includes('pickupPoint'));
 await f.service.acceptMail('rider', stored._id, { requestId: f.req('accept') });
 const accepted = await f.service.viewMail('rider', stored._id), ui = UI.detail(accepted);
 assert.equal(ui.pickupItems.length, 2); assert.equal(ui.pickupItems[0].code, 'PAIR-CODE');
 assert.equal(ui.pickupItems[1].pickupPoint, '五期 · 邮政'); assert.equal(ui.pickupItems[0].images.length, 0);
 assert.ok(ui.pickupItems[1].images[0].startsWith('https://signed.invalid/')); assert.equal(ui.history.length, 0);
 assert.equal(UI.detail({ ...accepted, myaccept: false, mypost: false }).pickupItems.length, 0);
});

test('server validates every modern parcel point without trusting an order-wide fallback', () => {
 const f = fixture(), rules = f.load('order_rules.js');
 const forms = () => [...f.forms().filter(item => item.mark !== 'address1'), { mark: 'packages', val: [{ type: 'small', price: 1.5, code: 'ONE', images: [], pickupPoint: '二期 · 中通' }] }];
 assert.equal(rules.validateForms(forms(), f.config, Date.now()).obj.packages[0].pickupPoint, '二期 · 中通');
 for (const value of ['', '   ', null, 123, {}, 'x'.repeat(101)]) {
  const input = forms(); input.at(-1).val[0].pickupPoint = value; input.push({ mark: 'address1', val: '不能替代本件取件点' });
  assert.throws(() => rules.validateForms(input, f.config, Date.now()), /取件点/);
 }
 const legacy = f.forms(); legacy.push({ mark: 'packages', val: [{ type: 'small', price: 1.5, code: 'OLD', images: [] }] });
 assert.equal(rules.validateForms(legacy, f.config, Date.now()).obj.packages[0].pickupPoint, '菜鸟一期');
});

test('legacy invalid media and empty parcel entries cannot move a photo to another parcel', async () => {
 const f = fixture(), media = f.load('private_media_service.js');
 const order = { mypost: true, MAIL_FORMS: [], MAIL_OBJ: { imgUrls: ['legacy-invalid-url'], packages: [null,
  { type: 'small', pickupPoint: '二期 · 中通', images: ['cloud://fixture/first.png'] },
  { type: 'small', pickupPoint: '五期 · 邮政', images: ['cloud://fixture/second.png'] }
 ] } };
 const ui = UI.detail(await media.order(order));
 assert.equal(ui.pickupItems.length, 2);
 assert.ok(ui.pickupItems[0].images[0].endsWith('first.png')); assert.ok(ui.pickupItems[1].images[0].endsWith('second.png'));
 assert.equal(ui.pickupItems[0].pickupPoint, '二期 · 中通'); assert.equal(ui.pickupItems[1].pickupPoint, '五期 · 邮政');
});

test('both form entries use one implementation and no longer bind the old pickup controls', () => {
 const folder = path.join(root, 'miniprogram/projects/crun/pages/mail/add');
 assert.match(fs.readFileSync(path.join(folder, 'mail_add.js'), 'utf8'), /Page\(require\('\.\/mail_add_logic\.js'\)\)/);
 assert.match(fs.readFileSync(path.join(folder, 'mail_add_embedded.wxml'), 'utf8'), /include src="\.\/mail_add\.wxml"/);
 const template = fs.readFileSync(path.join(folder, 'mail_add.wxml'), 'utf8');
 assert.ok(!/从哪里取|mailValues\.address1|bindOpenPickStation|bindSelectPickStation|data-mark="address1"/.test(template));
 assert.ok(template.includes('送到哪里'));
});
