'use strict';
// Offline, read-only review probe. Only this file is written; source is loaded into VMs.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const support = path.join(root, 'scripts/test-support/mail-form-harness.cjs');
const original = fs.readFileSync(support, 'utf8');
function reviewHarness({ delayed = false, baseline = false } = {}) {
  let source = original;
  if (baseline) source = source.replace("fs.readFileSync(file, 'utf8')", "fs.readFileSync(fs.existsSync(path.join(root, '.tmp/address-autofill-before', key)) ? path.join(root, '.tmp/address-autofill-before', key) : file, 'utf8')");
  if (delayed) {
    source = source.replace('let engine = null;', 'let engine = null; const propertyQueue = [];');
    source = source.replace('engine.data.forms = copy(this.data.formForms)', 'propertyQueue.push({ forms: copy(this.data.formForms) })');
    source = source.replace('engine.data.fields = copy(this.data.fields)', 'propertyQueue.push({ fields: copy(this.data.fields) })');
    source = source.replace('return { page, form, load, instance, config, wx, errors, commands, modals,', 'return { flushProperties() { for (const values of propertyQueue.splice(0)) Object.assign(engine.data, values); }, page, form, load, instance, config, wx, errors, commands, modals,');
  }
  const compiled = new Module(support, module);
  compiled.filename = support;
  compiled.paths = Module._nodeModulePaths(path.dirname(support));
  compiled._compile(source, support);
  return compiled.exports;
}
const value = (list, mark) => list.find(item => item.mark === mark)?.val;
const event = (mark, val) => ({ currentTarget: { dataset: { mark } }, detail: { value: val } });
const packageEvent = (mark, val) => ({ currentTarget: { dataset: { index: 0, mark } }, detail: { value: val } });

async function cycle(service, delayed) {
  const { harness, makeProfile } = reviewHarness({ delayed });
  const h = harness({ embedded: true, service });
  const flush = () => { if (h.flushProperties) h.flushProperties(); };
  await h.start(); flush();
  h.page.triggerEvent = name => { if (name === 'published') h.page.resetAfterPublish(); };
  for (let i = 0; i < 3; i++) {
    h.page.bindMailInput(event('poster', '手填联系人' + i));
    h.page.bindMailInput(event('tel', '1390000000' + i));
    h.page.bindMailInput(event('tel2', '备用' + i));
    h.page.bindMailInput(event('desc', '备注' + i));
    h.page.bindPackageItemInput(packageEvent('pickupPoint', '取件地点' + i));
    if (service === 'take') h.page.bindPackageItemInput(packageEvent('code', 'code' + i));
    if (service === 'buy') {
      h.page.bindMailInput(event('goods', '牛奶' + i));
      h.page.bindMailInput(event('buyQuantity', String(i + 1)));
      h.page.bindMailInput(event('goodsBudget', '12.00'));
    }
    flush();
    assert.equal(value(h.engine.data.fields, 'poster'), '手填联系人' + i);
    assert.ok(Array.isArray(value(h.engine.data.fields, 'img')));
    await h.page.bindFormSubmit();
    assert.equal(h.commands.length, i + 1, JSON.stringify(h.errors));
    const submitted = h.commands.at(-1).params.forms;
    assert.equal(value(submitted, 'poster'), '手填联系人' + i);
    assert.equal(value(submitted, 'tel'), '1390000000' + i);
    assert.equal(value(submitted, 'tel2'), '备用' + i);
    assert.equal(value(submitted, 'desc'), '备注' + i);
    assert.equal(value(submitted, 'serviceType'), service);
    h.modals.at(-1).success(); flush();
    assert.equal(value(h.engine.getForms(), 'desc'), '');
    assert.equal(value(h.engine.getForms(), 'tel2'), '');
    assert.equal(h.page.data.packageItems[0].pickupPoint, '');
    if (service === 'buy') assert.equal(h.page.data.mailValues.goods, undefined);
    h.setProfile(makeProfile('默认地址' + i)); await h.show(); flush();
    assert.equal(value(h.engine.data.fields, 'address2'), '一期 默认地址' + i);
    assert.equal(value(h.engine.getForms(), 'address2'), '一期 默认地址' + i);
    assert.equal(value(h.engine.getForms(), 'poster'), '联系人');
  }
  assert.deepEqual(h.errors, []);
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.tmp/address-autofill-before/manifest.json'), 'utf8'));
  const crypto = require('node:crypto');
  for (const entry of manifest) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, '.tmp/address-autofill-before', entry.path))).digest('hex');
    assert.equal(hash.toUpperCase(), entry.sha256, entry.path);
  }
  console.log('Baseline integrity:', manifest.length, 'files verified');
  for (const delayed of [false, true]) for (const service of ['take', 'send', 'buy']) {
    await cycle(service, delayed);
    console.log('PASS 3 consecutive publishes:', service, delayed ? 'delayed parent properties' : 'immediate parent properties');
  }
  for (const [mark, val] of [['address2', ''], ['poster', ''], ['tel', '123']]) {
    const { harness } = reviewHarness();
    const h = harness({ embedded: true }); await h.start();
    h.page.resetAfterPublish();
    h.page.bindPackageItemInput(packageEvent('pickupPoint', '取件地点'));
    h.page.bindPackageItemInput(packageEvent('code', '12345'));
    h.page.bindMailInput(event(mark, val));
    await h.page.bindFormSubmit();
    assert.equal(h.commands.length, 0);
    assert.ok(h.errors.length);
    console.log('PASS validation still blocks after reset:', mark, JSON.stringify(val));
  }
  for (const baseline of [true, false]) {
    const { harness } = reviewHarness({ baseline });
    const h = harness({ embedded: true }); await h.start();
    h.page.bindMailInput(event('address2', '本单临时地址'));
    let failure = null;
    try { h.page.resetAfterPublish(); } catch (error) { failure = error.message; }
    assert.equal(!!failure, baseline);
    console.log(baseline ? 'BASELINE expected reset failure:' : 'CURRENT reset passes:', failure || 'no exception');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
